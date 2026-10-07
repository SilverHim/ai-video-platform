import { describe, expect, it } from 'vitest';
import { toCurl } from '../request/curl.js';
import { redactUrl, sanitizeForPreview } from '../request/sanitize.js';
import { deepMerge, getPath, setPath, utf8Bytes } from '../request/wire.js';
import { encodeSse, SseParser } from '../sse/parse.js';

describe('wire', () => {
  it('setPath / getPath / deepMerge', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'a.b.c', 1);
    expect(getPath(o, 'a.b.c')).toBe(1);
    deepMerge(o, { a: { b: { d: 2 } }, arr: [1] });
    deepMerge(o, { arr: [2], skip: undefined });
    expect(o).toEqual({ a: { b: { c: 1, d: 2 } }, arr: [2] });
  });
  it('utf8Bytes', () => {
    expect(utf8Bytes('a')).toBe(1);
    expect(utf8Bytes('中')).toBe(3);
    expect(utf8Bytes('😀')).toBe(4);
  });
});

describe('sanitize', () => {
  it('截断 data URI，保留短字符串', () => {
    const data = `data:image/png;base64,${'A'.repeat(4000)}`;
    const out = sanitizeForPreview({ image: [data, 'https://x'], n: 1 });
    expect(out.image[0]).toMatch(/^data:image\/png;base64,…\(2\.9 KB\)$/);
    expect(out.image[1]).toBe('https://x');
  });
  it('打码 URL 签名参数', () => {
    expect(redactUrl('https://b.tos.com/a.mp4?X-Tos-Signature=abc&x=1')).toBe('https://b.tos.com/a.mp4?X-Tos-Signature=***&x=1');
  });
});

describe('curl', () => {
  it('Key 用环境变量占位，单引号转义', () => {
    const { command } = toCurl({ method: 'POST', url: 'https://x/api', body: { prompt: "it's" }, keyEnvVar: 'ARK_API_KEY' });
    expect(command).toContain('Bearer $ARK_API_KEY');
    expect(command).toContain(`it'\\''s`);
    expect(command).not.toMatch(/sk-/);
  });
  it('大请求体改用文件', () => {
    const r = toCurl({ method: 'POST', url: 'u', body: { x: 'a'.repeat(200) }, keyEnvVar: 'K', inlineLimit: 50 });
    expect(r.command).toContain('-d @request.json');
    expect(r.bodyFile).toContain('aaaa');
  });
});

describe('SseParser', () => {
  const sample = 'event: image_generation.partial_succeeded\r\ndata: {"a":1}\r\n\r\n: comment\nevent: x\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n';

  it('完整解析多行 data、CRLF、注释', () => {
    const p = new SseParser();
    const evs = [...p.feed(sample), ...p.flush()];
    expect(evs).toEqual([
      { event: 'image_generation.partial_succeeded', data: '{"a":1}' },
      { event: 'x', data: 'line1\nline2' },
      { event: null, data: '[DONE]' },
    ]);
  });

  it('任意位置切块结果一致', () => {
    for (let size = 1; size <= 7; size++) {
      const p = new SseParser();
      const evs = [];
      for (let i = 0; i < sample.length; i += size) evs.push(...p.feed(sample.slice(i, i + size)));
      evs.push(...p.flush());
      expect(evs.map((e) => e.data)).toEqual(['{"a":1}', 'line1\nline2', '[DONE]']);
    }
  });

  it('结尾没有空行也能 flush', () => {
    const p = new SseParser();
    expect(p.feed('data: tail')).toEqual([]);
    expect(p.flush()).toEqual([{ event: null, data: 'tail' }]);
  });

  it('encodeSse 往返', () => {
    const p = new SseParser();
    expect(p.feed(encodeSse({ event: 'ark.done', data: 'a\nb' }))).toEqual([{ event: 'ark.done', data: 'a\nb' }]);
  });
});
