/** 请求体路径工具：点分隔路径写入、深合并、稳定序列化 */

export type JsonObject = Record<string, unknown>;

export function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function setPath(target: JsonObject, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: JsonObject = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = cur[k];
    if (!isPlainObject(next)) cur[k] = {};
    cur = cur[k] as JsonObject;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function cloneJson<T extends JsonObject>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function getPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const k of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 深合并（数组整体替换，undefined 跳过） */
export function deepMerge(target: JsonObject, source: JsonObject): JsonObject {
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const cur = target[k];
    if (isPlainObject(cur) && isPlainObject(v)) deepMerge(cur, v);
    else target[k] = isPlainObject(v) ? deepMerge({}, v) : v;
  }
  return target;
}

/** UTF-8 字节数（纯计算，不依赖 Buffer / TextEncoder） */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}
