/**
 * 桌面版的安全策略（纯函数，便于测试）：
 * 窗口只停留在本机服务页面；外部链接交给系统浏览器；权限请求默认拒绝。
 */

/** 发布后不要改：Windows 安装包的 GUID 由它推导 */
export const DESKTOP_APP_ID = 'io.github.silverhim.aivideoplatform';
/** 系统应用数据目录下的文件夹名（ASCII，避免路径兼容问题；改产品名也不用迁移） */
export const DESKTOP_DATA_DIR_NAME = 'ai-video-platform';

/** 本机页面需要的权限：复制按钮（剪贴板写入）、视频全屏 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** 是否与本机服务同源（用 URL 解析比较，不做字符串前缀比较） */
export function isSameOrigin(url: string, serverUrl: string | null): boolean {
  if (!serverUrl) return false;
  const a = originOf(url);
  return a !== null && a === originOf(serverUrl);
}

/** 只放行本机页面发起的少数权限 */
export function isPermissionAllowed(permission: string, requestingUrl: string, serverUrl: string | null): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isSameOrigin(requestingUrl, serverUrl);
}

/** 可以交给系统浏览器打开的外部链接：只限 https / http，其余协议（file:、自定义协议等）一律不开 */
export function externalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Finder / 开始菜单启动时 PATH 很短：补上常见的 Homebrew 目录，便于找到 ffprobe */
export function desktopPath(current: string | undefined, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'darwin') return current;
  const parts = (current ?? '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean);
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) if (!parts.includes(dir)) parts.push(dir);
  return parts.join(':');
}

/** 服务进程发给主进程的消息 */
export type ServerMessage = { type: 'ready'; url: string; port: number; dataDir: string } | { type: 'error'; message: string };

export function parseServerMessage(data: unknown): ServerMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type === 'ready' && typeof m.url === 'string' && typeof m.port === 'number' && typeof m.dataDir === 'string') return { type: 'ready', url: m.url, port: m.port, dataDir: m.dataDir };
  if (m.type === 'error' && typeof m.message === 'string') return { type: 'error', message: m.message };
  return null;
}

/** 不能当作页面恢复的路径：接口、下载、MCP、静态资源 */
const NON_PAGE_PATH = /^\/(api|files|mcp|assets)(\/|$)/;

/**
 * 服务重启（端口可能变了）后主窗口要加载的地址：保留原来的前端页面路径；
 * 下载 / 接口地址、解析不了的地址回首页。逐项赋值而不是拼字符串，`//host` 这类路径也不会变成外部地址
 */
export function restoredUrl(current: string, base: string): string {
  const home = new URL('/', base).href;
  try {
    const u = new URL(current);
    if (NON_PAGE_PATH.test(u.pathname)) return home;
    const next = new URL(base);
    next.pathname = u.pathname;
    next.search = u.search;
    next.hash = u.hash;
    return isSameOrigin(next.href, base) ? next.href : home;
  } catch {
    return home;
  }
}

/** 读上次成功监听的端口（desktop-state.json）；内容不对就当没有 */
export function parseSavedPort(text: string): number | undefined {
  try {
    const port = (JSON.parse(text) as { port?: unknown }).port;
    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
}
