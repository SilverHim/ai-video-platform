import { acceptCompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptEditor } from './PromptEditor';

/** 在编辑器末尾输入 @ 并触发补全，返回补全项的标签 */
async function typeAt(container: HTMLElement): Promise<string[]> {
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
  view.dispatch({ changes: { from: view.state.doc.length, insert: '@' }, selection: { anchor: view.state.doc.length + 1 } });
  startCompletion(view);
  // 补全源是异步执行的；等一会儿再读结果
  await new Promise((r) => setTimeout(r, 100));
  return currentCompletions(view.state).map((c) => c.label);
}

afterEach(cleanup);

describe('PromptEditor', () => {
  it('占位文字随 props 更新（切换界面语言时）', () => {
    const { container, rerender } = render(<PromptEditor value="" onChange={() => undefined} refs={[]} placeholder="描述你想要的画面" />);
    expect(container.querySelector('.cm-placeholder')?.textContent).toBe('描述你想要的画面');
    rerender(<PromptEditor value="" onChange={() => undefined} refs={[]} placeholder="Describe the result" />);
    expect(container.querySelector('.cm-placeholder')?.textContent).toBe('Describe the result');
  });

  it('不可插入引用时，已有引用仍显示为编号而不是缺失', () => {
    const { container } = render(<PromptEditor value="{{ref:f}} starts to dance" onChange={() => undefined} refs={[{ id: 'f', label: 'Image 1' }]} insertable={false} />);
    const chip = container.querySelector('.cm-ref-chip');
    expect(chip?.textContent).toBe('Image 1');
    expect(chip?.classList.contains('cm-ref-missing')).toBe(false);
  });

  it('输入 @ 时：可插入则列出素材，不可插入则不弹出', async () => {
    const refs = [{ id: 'f', label: 'Image 1' }];
    const on = render(<PromptEditor value="" onChange={() => undefined} refs={refs} />);
    await vi.waitFor(async () => expect(await typeAt(on.container)).toEqual(['@Image 1']));
    cleanup();
    const off = render(<PromptEditor value="" onChange={() => undefined} refs={refs} insertable={false} />);
    expect(await typeAt(off.container)).toEqual([]);
  });

  it('同一编辑器从可插入切到不可插入：已弹出的列表消失，不能再接受', async () => {
    const refs = [{ id: 'f', label: 'Image 1' }];
    // value 前后都是 "@"，排除"外部值变化清空了文本"导致列表关闭的情况
    const { container, rerender } = render(<PromptEditor value="@" onChange={() => undefined} refs={refs} />);
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
    view.dispatch({ selection: { anchor: 1 } });
    startCompletion(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).map((c) => c.label)).toEqual(['@Image 1']));
    rerender(<PromptEditor value="@" onChange={() => undefined} refs={refs} insertable={false} />);
    expect(view.state.doc.toString()).toBe('@');
    expect(currentCompletions(view.state)).toEqual([]);
    expect(acceptCompletion(view)).toBe(false);
    expect(view.state.doc.toString()).not.toContain('{{ref:');
  });
});
