/** 增量 SSE 解析器：支持多行 data、CRLF、注释行、任意位置切块 */

export interface SseEvent {
  event: string | null;
  data: string;
  id?: string;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName: string | null = null;
  private lastId: string | undefined;

  /** 喂入一段文本，返回已完整的事件 */
  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const nl = this.buffer.search(/\r\n|\r|\n/);
      if (nl < 0) break;
      // \r 在块尾时可能后面紧跟 \n，等下一块再处理
      if (this.buffer[nl] === '\r' && nl === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, nl);
      const sepLen = this.buffer.startsWith('\r\n', nl) ? 2 : 1;
      this.buffer = this.buffer.slice(nl + sepLen);
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** 流结束：把未以空行结束的最后一个事件也吐出来 */
  flush(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buffer.length) {
      const ev = this.line(this.buffer.replace(/\r$/, ''));
      if (ev) out.push(ev);
      this.buffer = '';
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;
    const idx = line.indexOf(':');
    const field = idx < 0 ? line : line.slice(0, idx);
    let value = idx < 0 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventName = value;
    else if (field === 'id') this.lastId = value;
    return null;
  }

  private dispatch(): SseEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = null;
      return null;
    }
    const ev: SseEvent = { event: this.eventName, data: this.dataLines.join('\n'), ...(this.lastId !== undefined ? { id: this.lastId } : {}) };
    this.dataLines = [];
    this.eventName = null;
    return ev;
  }
}

/** 把事件编码回 SSE 文本 */
export function encodeSse(ev: { event?: string | null; data: string }): string {
  const lines: string[] = [];
  if (ev.event) lines.push(`event: ${ev.event}`);
  for (const l of ev.data.split('\n')) lines.push(`data: ${l}`);
  return `${lines.join('\n')}\n\n`;
}
