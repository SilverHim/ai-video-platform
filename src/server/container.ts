import { AssetStore } from './assets/asset-store.js';
import { AssetResolver } from './assets/resolver.js';
import { CaptureService } from './capture/capture.js';
import { HttpDownloader, type Downloader } from './capture/downloader.js';
import type { ResolvedConfig } from './config.js';
import { EventBus } from './events.js';
import { Keystore } from './keystore.js';
import { MockDownloader, mockFetch } from './mock/upstream.js';
import { Store } from './store/store.js';
import * as registry from '../shared/providers/registry.js';
import { Scheduler } from './tasks/scheduler.js';
import { TaskService, type Catalog } from './tasks/task-service.js';
import { UpstreamClient, type FetchLike } from './upstream/http.js';

export interface Container {
  keystore: Keystore;
  store: Store;
  services: { tasks: TaskService; assets: AssetStore; capture: CaptureService; events: EventBus; scheduler: Scheduler };
  close: () => Promise<void>;
}

/** 组装服务；测试可注入 fetch / downloader */
export function createContainer(config: ResolvedConfig, opts: { fetchImpl?: FetchLike; downloader?: Downloader; env?: NodeJS.ProcessEnv; catalog?: Catalog } = {}): Container {
  const keystore = new Keystore(config.paths.keys, opts.env ?? process.env);
  const store = new Store(config.paths.db);
  const upstream = new UpstreamClient(opts.fetchImpl ?? (config.mock ? mockFetch : undefined));
  const downloader = opts.downloader ?? (config.mock ? new MockDownloader() : new HttpDownloader());
  const assets = new AssetStore(store, config.paths.root);
  const capture = new CaptureService(store, config.paths.outputs, downloader);
  const resolver = new AssetResolver(store, assets, config.paths.outputs);
  const events = new EventBus();
  const catalog = opts.catalog ?? registry;
  const emit = (taskId: string) => {
    const task = store.getTask(taskId);
    if (task) events.emit({ type: 'task.updated', task });
  };
  const scheduler = new Scheduler({ store, keystore, upstream, capture, catalog, emit, mock: config.mock });
  const tasks = new TaskService({ store, keystore, upstream, capture, resolver, events, catalog, mock: config.mock, onTaskCreated: (id) => scheduler.track(id) });
  return {
    keystore,
    store,
    services: { tasks, assets, capture, events, scheduler },
    close: async () => {
      scheduler.stop();
      await upstream.close();
      if (downloader instanceof HttpDownloader) await downloader.close();
      store.close();
    },
  };
}
