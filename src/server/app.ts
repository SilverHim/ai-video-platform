import { Hono } from 'hono';
import type { AssetStore } from './assets/asset-store.js';
import type { CaptureService } from './capture/capture.js';
import type { ResolvedConfig } from './config.js';
import type { ArkControlClient } from './controlplane/ark-control.js';
import type { EndpointDirectory } from './controlplane/directory.js';
import type { EventBus } from './events.js';
import type { Keystore } from './keystore.js';
import { accessLog } from './middleware/logger.js';
import { localGuard, localHostSet, localOriginSet } from './middleware/local-guard.js';
import { securityHeaders } from './middleware/security-headers.js';
import { assetRoutes } from './routes/assets.js';
import { eventRoutes } from './routes/events.js';
import { fileRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';
import { endpointRoutes } from './routes/endpoints.js';
import { keyRoutes } from './routes/keys.js';
import { taskRoutes } from './routes/tasks.js';
import { libraryRoutes } from './routes/library.js';
import { mcpRoutes } from './mcp/route.js';
import { McpTokenStore } from './mcp/token.js';
import type { Catalog } from './tasks/task-service.js';
import { staticSite } from './static.js';
import type { Store } from './store/store.js';
import type { Scheduler } from './tasks/scheduler.js';
import type { TaskService } from './tasks/task-service.js';

/** 接入命令里给 Claude Code 设的单服务器超时（毫秒） */
export const MCP_CLIENT_TIMEOUT_MS = 600_000;

/**
 * 设置页的接入命令（按服务所在系统给出：Windows 用 PowerShell 写法，其余用 sh 写法）。
 * 用 add-json 才能带上 timeout：Claude Code 对 HTTP 服务器默认每个请求只等 60 秒（到第一个响应字节），
 * 出图常要 1–3 分钟；timeout 同时提高这个计时器（与 docs/agent-setup.md 同样写法）
 */
export function mcpConnectCommand(url: string, token: string, platform: NodeJS.Platform = process.platform): string {
  const entry = JSON.stringify({ type: 'http', url, headers: { Authorization: `Bearer ${token}` }, timeout: MCP_CLIENT_TIMEOUT_MS });
  if (platform === 'win32') {
    // 在脚本块里统一按 Legacy 方式给命令行程序传参（5.1 只有这种方式；7.x 默认方式对 .cmd / .bat 启动器也会回到 Legacy；
    // 只影响这个脚本块）。Legacy 下参数含空格会被切开，所以 JSON 里的空格写成 \u0020（解析后还原），再把 " 转义成 \"。
    // 已在 GitHub 的 Windows 虚拟机上用 PowerShell 5.1 与 7 实测（含 npm 的 claude.ps1 垫片）
    const noSpace = entry.replace(/ /g, '\\u0020');
    return `& { $PSNativeCommandArgumentPassing = 'Legacy'; claude mcp remove ai-video --scope user 2>$null | Out-Null; claude mcp add-json --scope user ai-video ('${noSpace}' -replace '"', '\\"') }`;
  }
  return `claude mcp remove ai-video --scope user 2>/dev/null; claude mcp add-json --scope user ai-video '${entry}'`;
}

export interface Services {
  tasks: TaskService;
  assets: AssetStore;
  capture: CaptureService;
  events: EventBus;
  scheduler: Scheduler;
  /** ModelArk 控制面（推理接入点管理，AK/SK） */
  control: ArkControlClient;
  /** 推理接入点列表（带缓存，网页与 MCP 共用） */
  endpoints: EndpointDirectory;
}

export interface AppDeps {
  config: ResolvedConfig;
  keystore: Keystore;
  store: Store;
  services: Services;
  version: string;
  /** 实际监听端口（listen 之后才知道，所以用函数） */
  getPort: () => number;
  /** 测试时关闭访问日志 */
  quiet?: boolean;
  /** 测试注入的模型目录（默认全局注册表） */
  catalog?: Catalog;
}

export function createApp(deps: AppDeps) {
  const ports = () => {
    const list = [deps.getPort()];
    if (deps.config.dev) list.push(deps.config.devWebPort);
    return list;
  };

  const app = new Hono();
  app.use('*', accessLog(!deps.quiet));
  app.use('*', securityHeaders());
  app.use('*', localGuard({ allowedHosts: () => localHostSet(ports()), allowedOrigins: () => localOriginSet(ports()) }));

  app.route('/api/health', healthRoutes(deps));
  app.route('/api/keys', keyRoutes(deps));
  app.route('/api/assets', assetRoutes(deps));
  app.route('/api/events', eventRoutes(deps));
  app.route('/api', taskRoutes(deps));
  app.route('/api', libraryRoutes(deps));
  app.route('/api', endpointRoutes(deps));
  const mcpToken = new McpTokenStore(deps.config.paths.mcpToken);
  // 启动时就生成令牌文件：agent 按 docs/agent-setup.md 接入时，全新安装也能直接读到
  mcpToken.get();
  app.get('/api/mcp', (c) => {
    const url = `http://127.0.0.1:${deps.getPort()}/mcp`;
    const token = mcpToken.get();
    return c.json({ url, token, command: mcpConnectCommand(url, token) });
  });
  app.post('/api/mcp/rotate', (c) => c.json({ token: mcpToken.rotate() }));
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404));
  app.route('/mcp', mcpRoutes({ ...deps, mcpToken }));
  app.route('/files', fileRoutes(deps));

  if (deps.config.staticDir) app.use('*', staticSite(deps.config.staticDir));

  app.onError((err, c) => {
    console.error('[server] 未处理的错误：', err instanceof Error ? err.message : err);
    return c.json({ error: { code: 'internal_error', message: '服务内部错误' } }, 500);
  });
  return app;
}
