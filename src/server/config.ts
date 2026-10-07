import { mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_PORT } from '../shared/api-contract.js';

export interface ServerOptions {
  /** 监听端口；0 表示由系统分配。生产模式下端口被占用会依次尝试后续端口 */
  port?: number;
  /** 所有运行时数据（keys.json、SQLite、outputs、缓存）的根目录 */
  dataDir: string;
  /** 构建后的前端目录（dist/web）；开发模式下由 Vite 提供页面，可不传 */
  staticDir?: string;
  /** 是否开发模式：允许 Vite 开发服务器的 Host/Origin */
  dev?: boolean;
  /** 上游使用内置 mock，不需要 Key、不计费 */
  mock?: boolean;
  /** 开发模式下 Vite 的端口 */
  devWebPort?: number;
  /** 端口被占用时最多向后尝试几个 */
  portRetries?: number;
}

export interface ResolvedConfig extends Required<Omit<ServerOptions, 'staticDir'>> {
  staticDir: string | null;
  paths: DataPaths;
}

export interface DataPaths {
  root: string;
  keys: string;
  outputs: string;
  cache: string;
  db: string;
  mcpToken: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const root = resolve(dataDir);
  return {
    root,
    keys: join(root, 'keys.json'),
    outputs: join(root, 'outputs'),
    cache: join(root, '.cache'),
    db: join(root, 'app.db'),
    mcpToken: join(root, 'mcp-token'),
  };
}

export function resolveConfig(opts: ServerOptions): ResolvedConfig {
  const paths = dataPaths(opts.dataDir);
  return {
    port: opts.port ?? DEFAULT_PORT,
    dataDir: paths.root,
    staticDir: opts.staticDir ? resolve(opts.staticDir) : null,
    dev: opts.dev ?? false,
    mock: opts.mock ?? false,
    devWebPort: opts.devWebPort ?? 5173,
    portRetries: opts.portRetries ?? (opts.dev ? 0 : 20),
    paths,
  };
}

/** 创建数据目录；POSIX 下限制为仅当前用户可访问 */
export function ensureDataDirs(paths: DataPaths): void {
  for (const dir of [paths.root, paths.outputs, paths.cache]) mkdirSync(dir, { recursive: true });
  if (process.platform !== 'win32') {
    try {
      chmodSync(paths.root, 0o700);
    } catch {
      // 忽略：例如数据目录在不支持权限的文件系统上
    }
  }
}
