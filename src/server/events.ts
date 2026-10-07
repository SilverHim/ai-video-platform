import { EventEmitter } from 'node:events';
import type { ServerEvent } from '../shared/task/records.js';

/** 进程内事件总线：任务变化推送给 /api/events 的所有订阅者（网页） */
export class EventBus {
  private ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(100);
  }

  emit(ev: ServerEvent): void {
    this.ee.emit('event', ev);
  }

  subscribe(fn: (ev: ServerEvent) => void): () => void {
    this.ee.on('event', fn);
    return () => this.ee.off('event', fn);
  }
}
