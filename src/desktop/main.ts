/**
 * 桌面版主进程：只负责窗口与生命周期；本机服务在 utilityProcess 里运行（见 server-entry.ts），
 * 数据库的同步读写不会卡住界面线程，服务崩溃也不会带走整个应用。
 * 打包为 CommonJS（main.cjs）：app ready 之前的 setPath / 单实例锁按顺序同步执行。
 */
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, session, shell, utilityProcess, type UtilityProcess, type WebPreferences } from 'electron';
import { APP_DISPLAY_NAME, CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../shared/api-contract.js';
import { DESKTOP_APP_ID, DESKTOP_DATA_DIR_NAME, desktopPath, externalUrl, isPermissionAllowed, isSameOrigin, parseSavedPort, parseServerMessage, restoredUrl } from './policy.js';

/** CI 冒烟测试：在打包后的运行时里真起一次服务、读写一次数据库，然后退出 */
const SMOKE = process.argv.includes('--smoke-test');
const SHUTDOWN_TIMEOUT_MS = 8_000;
/** 冒烟测试整体时限：任何一步卡住都按失败退出，避免 CI 挂住 */
const SMOKE_DEADLINE_MS = 120_000;
const SMOKE_FETCH_TIMEOUT_MS = 15_000;
const SAFE_WEB_PREFERENCES: WebPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false };

if (SMOKE) {
  // 从最开始就兜底：ready 前卡住、未捕获异常（Electron 默认会弹模态框挂住 CI）都按失败退出
  setTimeout(() => {
    console.error(`[smoke] ${SMOKE_DEADLINE_MS / 1000} 秒内没有完成`);
    app.exit(2);
  }, SMOKE_DEADLINE_MS);
  process.on('uncaughtException', (err) => {
    console.error('[smoke] 未捕获异常：', err);
    app.exit(1);
  });
}

// 数据目录显式指定，不依赖 productName 推导：<系统应用数据>/ai-video-platform/；
// 命令行带 --user-data-dir（Chromium 标准开关）时用它指定的目录，便于测试
if (SMOKE) app.setPath('userData', mkdtempSync(join(tmpdir(), 'aivp-smoke-')));
else if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), DESKTOP_DATA_DIR_NAME));
if (process.platform === 'win32') app.setAppUserModelId(DESKTOP_APP_ID);

const logDir = join(app.getPath('userData'), 'logs');
const serverLog = join(logDir, 'server.log');
/** 记住上次成功监听的端口：页面的源（含端口）与 MCP 地址保持稳定 */
const stateFile = join(app.getPath('userData'), 'desktop-state.json');

let server: UtilityProcess | null = null;
let serverUrl: string | null = null;
let lastPort: number | undefined;
/** 已进入退出流程（before-quit 发生过）：不再开窗口，改为退出后重新启动 */
let quitting = false;
/** 正在关停服务：之后服务进程退出不算崩溃 */
let stopping = false;
/** 服务已收尾或放弃等待：before-quit 不再拦截 */
let quitReady = false;
/** app.relaunch() 多次调用会起多个实例，只调一次 */
let relaunchRequested = false;
let mainWindow: BrowserWindow | null = null;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 每次启动应用时把上一次的日志留一份 */
function rotateLog() {
  mkdirSync(logDir, { recursive: true });
  try {
    if (existsSync(serverLog) && statSync(serverLog).size > 0) renameSync(serverLog, join(logDir, 'server.prev.log'));
  } catch {
    // 日志轮转失败不影响启动
  }
}

function readSavedPort(): number | undefined {
  try {
    return parseSavedPort(readFileSync(stateFile, 'utf8'));
  } catch {
    return undefined;
  }
}

function savePort(port: number) {
  try {
    writeFileSync(stateFile, `${JSON.stringify({ port })}\n`);
  } catch {
    // 记不住端口只影响下次的首选端口
  }
}

/** 启动服务进程，等它报告监听地址；port 是首选端口，被占用时服务会往后试 */
function launchServer(port?: number): Promise<string> {
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(serverLog, { flags: 'a' });
  // 不用 pipe：日志写失败时 pipe 会停止读取，Windows 上子进程的管道一满就卡在 console.log。
  // 这里一直把输出读走，写不进日志就丢弃
  let logWritable = true;
  log.on('error', () => {
    logWritable = false;
  });
  const sink = (chunk: Buffer) => {
    if (logWritable) log.write(chunk);
  };
  const args = ['--data-dir', join(app.getPath('userData'), 'data'), '--static-dir', join(__dirname, 'web'), '--version', app.getVersion()];
  if (port !== undefined) args.push('--port', String(port));
  const child = utilityProcess.fork(join(__dirname, 'server.mjs'), args, {
    serviceName: `${APP_DISPLAY_NAME} 本机服务`,
    stdio: 'pipe',
    env: { ...process.env, PATH: desktopPath(process.env.PATH, process.platform) },
  });
  child.stdout?.on('data', sink);
  child.stderr?.on('data', sink);
  server = child;

  return new Promise((resolve, reject) => {
    let state: 'starting' | 'ready' | 'failed' = 'starting';
    child.on('message', (data: unknown) => {
      const msg = parseServerMessage(data);
      if (!msg || state !== 'starting') return;
      if (msg.type === 'ready') {
        state = 'ready';
        lastPort = msg.port;
        resolve(msg.url);
      } else {
        state = 'failed';
        reject(new Error(msg.message));
      }
    });
    child.once('exit', (code) => {
      log.end();
      if (server === child) server = null;
      if (state === 'starting') {
        state = 'failed';
        reject(new Error(`服务进程退出（代码 ${code}）`));
      } else if (state === 'ready' && !stopping && !SMOKE) {
        void onServerCrashed(code);
      }
    });
  });
}

/** 通知服务进程收尾（关监听、关数据库）；超时则强制结束 */
function stopServer(): Promise<void> {
  const child = server;
  if (!child) return Promise.resolve();
  stopping = true;
  return new Promise((resolve) => {
    const kill = setTimeout(() => child.kill(), SHUTDOWN_TIMEOUT_MS);
    // kill 之后仍收不到 exit（极少见）也要让退出流程继续
    const giveUp = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS + 2_000);
    child.once('exit', () => {
      clearTimeout(kill);
      clearTimeout(giveUp);
      resolve();
    });
    try {
      child.postMessage({ type: 'shutdown' });
    } catch {
      child.kill();
    }
  });
}

async function onServerCrashed(code: number) {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    message: '本机服务意外退出',
    detail: `退出代码 ${code}。日志：${serverLog}`,
    buttons: ['重新启动', '退出'],
    defaultId: 0,
    cancelId: 1,
  });
  if (quitting) return;
  if (response !== 0) {
    app.quit();
    return;
  }
  try {
    const url = await launchServer(lastPort);
    if (quitting) return;
    serverUrl = url;
    // 原图等子窗口直接关掉；主窗口回到原来的页面（端口可能变了）
    for (const w of BrowserWindow.getAllWindows()) if (w !== mainWindow) w.close();
    if (mainWindow) void mainWindow.loadURL(restoredUrl(mainWindow.webContents.getURL(), url));
    else createWindow(url);
  } catch (err) {
    if (quitting) return;
    dialog.showErrorBox(APP_DISPLAY_NAME, `本机服务重启失败：${errorText(err)}\n\n日志：${serverLog}`);
    app.quit();
  }
}

function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: APP_DISPLAY_NAME,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f12' : '#f7f7f8',
    webPreferences: SAFE_WEB_PREFERENCES,
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // Windows 关机 / 注销不会发 before-quit：服务进程被系统结束时不要当成崩溃弹框，并尽量让它收尾
  win.on('session-end', () => {
    quitting = true;
    stopping = true;
    try {
      server?.postMessage({ type: 'shutdown' });
    } catch {
      // 服务已经不在了
    }
  });
  void win.loadURL(url);
  mainWindow = win;
}

/** 打开或切到主窗口；已在退出时改为退出后重新启动应用 */
function showMainWindow() {
  if (quitting) {
    if (!relaunchRequested) {
      relaunchRequested = true;
      app.relaunch();
    }
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (serverUrl) createWindow(serverUrl);
}

function openExternal(url: string) {
  const safe = externalUrl(url);
  if (safe) void shell.openExternal(safe);
}

/** 权限请求默认拒绝（Electron 默认全部批准）：只放行本机页面的剪贴板写入与全屏 */
function installSessionPolicy() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(isPermissionAllowed(permission, details.requestingUrl, serverUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => isPermissionAllowed(permission, requestingOrigin, serverUrl));
}

// 窗口只停留在本机服务页面：其他地址交给系统浏览器；同源的新窗口（如打开原图）沿用安全设置
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event) => {
    if (isSameOrigin(event.url, serverUrl)) return;
    event.preventDefault();
    openExternal(event.url);
  });
  contents.on('will-redirect', (event) => {
    if (!isSameOrigin(event.url, serverUrl)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, serverUrl)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1200, height: 800, webPreferences: SAFE_WEB_PREFERENCES } };
    openExternal(url);
    return { action: 'deny' };
  });
});

app.on('before-quit', (event) => {
  quitting = true;
  if (!server || quitReady) return;
  event.preventDefault();
  if (stopping) return;
  void stopServer().then(() => {
    quitReady = true;
    app.quit();
  });
});

async function boot() {
  try {
    installSessionPolicy();
    rotateLog();
    const saved = readSavedPort();
    const url = await launchServer(saved);
    if (lastPort !== undefined && lastPort !== saved) savePort(lastPort);
    // 启动中途用户已经退出：不再开窗口
    if (quitting) return;
    serverUrl = url;
    createWindow(url);
  } catch (err) {
    // 启动中途用户退出（服务被关掉）不算启动失败
    if (quitting) return;
    dialog.showErrorBox(APP_DISPLAY_NAME, `本机服务启动失败：${errorText(err)}\n\n日志：${serverLog}`);
    app.quit();
  }
}

async function smokeChecks(): Promise<boolean> {
  const url = await launchServer(0);
  const get = (path: string, headers?: Record<string, string>) => fetch(`${url}${path}`, { ...(headers ? { headers } : {}), signal: AbortSignal.timeout(SMOKE_FETCH_TIMEOUT_MS) });
  const headers = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };
  const health = (await (await get('/api/health', headers)).json()) as { ok?: boolean; node?: string };
  // 任务列表读 SQLite：确认打包后的运行时里 node:sqlite 可用
  const tasks = await get('/api/tasks', headers);
  const page = await get('/');
  const html = await page.text();
  console.log(`[smoke] health=${JSON.stringify(health)} tasks=${tasks.status} page=${page.status}`);
  return health.ok === true && tasks.ok && page.ok && html.includes('id="root"');
}

async function runSmoke() {
  let ok = false;
  try {
    ok = await smokeChecks();
  } catch (err) {
    console.error('[smoke] 出错：', err);
  } finally {
    try {
      await stopServer();
      if (!ok) console.error(readFileSync(serverLog, 'utf8'));
    } catch {
      // 没有日志
    }
    try {
      rmSync(app.getPath('userData'), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Windows 上 Chromium 可能还占着临时目录里的文件：留给系统清理
    }
    console.log(ok ? '[smoke] 通过' : '[smoke] 未通过');
    app.exit(ok ? 0 : 1);
  }
}

if (SMOKE) {
  void app.whenReady().then(runSmoke);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  // mac 惯例：关窗口不退出，任务继续在后台轮询；点 Dock 图标重新打开
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', showMainWindow);
  void app.whenReady().then(boot);
}
