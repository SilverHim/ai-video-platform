import type { AssetRef, MediaKind, ModeDef, RefOrder } from '../catalog/types.js';

/**
 * 素材编号：同类素材按"槽位声明顺序 → 槽位内顺序"从 1 开始编号。
 * 请求里 content[] 的顺序必须用同一个函数决定，保证"Image n"与第 n 个图片一致。
 */
export function computeRefOrder(mode: ModeDef, slots: Record<string, AssetRef[]>): RefOrder {
  const counters: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 };
  const order: RefOrder = {};
  for (const slot of mode.slots) {
    const items = slots[slot.id] ?? [];
    items.forEach((a, index) => {
      counters[slot.kind] += 1;
      order[a.id] = { kind: slot.kind, n: counters[slot.kind], slotId: slot.id, index };
    });
  }
  return order;
}

/** 按 computeRefOrder 的顺序列出某类素材 */
export function orderedAssets(mode: ModeDef, slots: Record<string, AssetRef[]>, kind?: MediaKind): { asset: AssetRef; slotId: string; role?: string }[] {
  const out: { asset: AssetRef; slotId: string; role?: string }[] = [];
  for (const slot of mode.slots) {
    if (kind && slot.kind !== kind) continue;
    for (const a of slots[slot.id] ?? []) out.push({ asset: a, slotId: slot.id, ...(slot.role ? { role: slot.role } : {}) });
  }
  return out;
}

const REF_TOKEN = /\{\{ref:([A-Za-z0-9_-]+)\}\}/g;

/** 把 {{ref:<id>}} 渲染成模型要求的写法；找不到的引用返回在 missing 里 */
export function renderPrompt(prompt: string, order: RefOrder, refLabel?: (kind: MediaKind, n: number) => string): { text: string; missing: string[] } {
  const missing: string[] = [];
  const label = refLabel ?? ((k, n) => `${k === 'image' ? 'Image' : k === 'video' ? 'Video' : 'Audio'} ${n}`);
  const text = prompt.replace(REF_TOKEN, (_m, id: string) => {
    const info = order[id];
    if (!info) {
      missing.push(id);
      return '';
    }
    return label(info.kind, info.n);
  });
  return { text, missing };
}

export function promptRefIds(prompt: string): string[] {
  return [...prompt.matchAll(REF_TOKEN)].map((m) => m[1]!);
}

/** 粗略统计：中文字符数与英文单词数（用于软上限提示） */
export function countPrompt(text: string): { zhChars: number; enWords: number; chars: number } {
  const zhChars = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const enWords = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  return { zhChars, enWords, chars: [...text].length };
}
