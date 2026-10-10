import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { Decoration, EditorView, keymap, MatchDecorator, placeholder as cmPlaceholder, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface RefOption {
  id: string;
  /** 渲染后的写法，如 Image 1 */
  label: string;
  detail?: string;
}

export interface PromptEditorHandle {
  insertRef: (id: string) => void;
  focus: () => void;
}

class RefWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly missing: boolean,
  ) {
    super();
  }
  override eq(o: RefWidget) {
    return o.text === this.text && o.missing === this.missing;
  }
  toDOM() {
    const el = document.createElement('span');
    el.textContent = this.text;
    el.className = this.missing ? 'cm-ref-chip cm-ref-missing' : 'cm-ref-chip';
    return el;
  }
}

function refPlugin(labels: Map<string, string>) {
  const deco = new MatchDecorator({
    regexp: /\{\{ref:([A-Za-z0-9_-]+)\}\}/g,
    decoration: (m) => {
      const label = labels.get(m[1]!);
      return Decoration.replace({ widget: new RefWidget(label ?? '⚠', !label) });
    },
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = deco.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = deco.updateDeco(u, this.decorations);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
    },
  );
}

/** 输入 @ 弹出当前素材列表；不可插入时整个补全扩展被移除（见 completionComp），已弹出的列表一并消失 */
function refCompletion(refs: { current: RefOption[] }) {
  const complete = (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/@[\w ]*$/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return {
      from: word.from,
      options: refs.current.map((r) => ({ label: `@${r.label}`, detail: r.detail ?? '', apply: `{{ref:${r.id}}}` })),
      filter: true,
    };
  };
  return autocompletion({ override: [complete], activateOnTyping: true });
}

const theme = EditorView.theme({
  '&': { fontSize: '14px', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'transparent' },
  '&.cm-focused': { outline: '2px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' },
  '.cm-content': { minHeight: '96px', padding: '8px', fontFamily: 'inherit', caretColor: 'var(--color-text)' },
  '.cm-line': { lineHeight: '1.6' },
  '.cm-ref-chip': { background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', color: 'var(--color-accent)', borderRadius: '4px', padding: '0 4px', fontSize: '12px' },
  '.cm-ref-missing': { background: 'color-mix(in srgb, var(--color-danger) 18%, transparent)', color: 'var(--color-danger)' },
  '.cm-placeholder': { color: 'var(--color-muted)' },
});

/**
 * 提示词编辑器：内部以 {{ref:<id>}} 保存素材引用，显示成"Image 1"芯片；
 * 输入 @ 弹出当前素材列表。素材重排后编号自动更新。
 * insertable=false：模型没有素材编号写法，不弹出 @ 列表，但已有的引用仍按 refs 显示
 */
export const PromptEditor = forwardRef<PromptEditorHandle, { value: string; onChange: (v: string) => void; refs: RefOption[]; insertable?: boolean; placeholder?: string }>(function PromptEditor(
  { value, onChange, refs, insertable = true, placeholder },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const refComp = useRef(new Compartment());
  // 占位文字单独放一个 Compartment：切换界面语言时能重新配置
  const placeholderComp = useRef(new Compartment());
  // 补全单独放一个 Compartment：模式不允许插入引用时整个移除
  const completionComp = useRef(new Compartment());
  const refsRef = useRef(refs);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    refsRef.current = refs;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          theme,
          placeholderComp.current.of(cmPlaceholder(placeholder ?? '')),
          completionComp.current.of(insertable ? refCompletion(refsRef) : []),
          refComp.current.of(refPlugin(new Map(refs.map((r) => [r.id, r.label])))),
          EditorView.updateListener.of((u) => u.docChanged && onChangeRef.current(u.state.doc.toString())),
        ],
      }),
    });
    return () => view.current?.destroy();
    // 编辑器只创建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值变化（例如复用参数）时同步
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  // 切换模式（是否允许插入引用）时增删补全
  useEffect(() => {
    view.current?.dispatch({ effects: completionComp.current.reconfigure(insertable ? refCompletion(refsRef) : []) });
  }, [insertable]);

  // 切换界面语言时更新占位文字
  useEffect(() => {
    view.current?.dispatch({ effects: placeholderComp.current.reconfigure(cmPlaceholder(placeholder ?? '')) });
  }, [placeholder]);

  // 素材编号变化时重绘芯片
  const labelsKey = refs.map((r) => `${r.id}:${r.label}`).join('|');
  useEffect(() => {
    view.current?.dispatch({ effects: refComp.current.reconfigure(refPlugin(new Map(refsRef.current.map((r) => [r.id, r.label])))) });
  }, [labelsKey]);

  useImperativeHandle(ref, () => ({
    insertRef: (id: string) => {
      const v = view.current;
      if (!v) return;
      const pos = v.state.selection.main.head;
      const text = `{{ref:${id}}}`;
      v.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      v.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return <div ref={host} data-testid="prompt-editor" />;
});
