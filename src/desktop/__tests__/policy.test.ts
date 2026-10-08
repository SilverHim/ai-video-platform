import { describe, expect, it } from 'vitest';
import { desktopPath, externalUrl, isPermissionAllowed, isSameOrigin, parseSavedPort, parseServerMessage, restoredUrl } from '../policy.js';

const SERVER = 'http://127.0.0.1:8787';

describe('桌面版安全策略', () => {
  it('同源判断按 URL 解析，不被前缀或 userinfo 骗过', () => {
    expect(isSameOrigin('http://127.0.0.1:8787/settings', SERVER)).toBe(true);
    expect(isSameOrigin('http://127.0.0.1:8788/', SERVER)).toBe(false);
    expect(isSameOrigin('http://127.0.0.1:8787.evil.com/', SERVER)).toBe(false);
    expect(isSameOrigin('http://127.0.0.1:8787@evil.com/', SERVER)).toBe(false);
    expect(isSameOrigin('http://localhost:8787/', SERVER)).toBe(false);
    expect(isSameOrigin('not a url', SERVER)).toBe(false);
    expect(isSameOrigin('http://127.0.0.1:8787/', null)).toBe(false);
  });

  it('权限只放行本机页面的剪贴板写入与全屏', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', `${SERVER}/`, SERVER)).toBe(true);
    expect(isPermissionAllowed('fullscreen', `${SERVER}/history`, SERVER)).toBe(true);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']) expect(isPermissionAllowed(p, `${SERVER}/`, SERVER)).toBe(false);
    expect(isPermissionAllowed('fullscreen', 'https://example.com/', SERVER)).toBe(false);
  });

  it('外部链接只开 http / https', () => {
    expect(externalUrl('https://docs.byteplus.com/x')).toBe('https://docs.byteplus.com/x');
    expect(externalUrl('http://example.com')).toBe('http://example.com/');
    expect(externalUrl('file:///etc/passwd')).toBeNull();
    expect(externalUrl('javascript:alert(1)')).toBeNull();
    expect(externalUrl('smb://host/share')).toBeNull();
    expect(externalUrl('::')).toBeNull();
  });

  it('mac 上补 Homebrew 目录，其他平台原样', () => {
    expect(desktopPath('/usr/bin:/bin', 'darwin')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
    expect(desktopPath('/opt/homebrew/bin:/usr/bin', 'darwin')).toBe('/opt/homebrew/bin:/usr/bin:/usr/local/bin');
    expect(desktopPath(undefined, 'darwin')).toContain('/opt/homebrew/bin');
    expect(desktopPath('C:\\Windows', 'win32')).toBe('C:\\Windows');
  });

  it('只认格式正确的服务进程消息', () => {
    expect(parseServerMessage({ type: 'ready', url: SERVER, port: 8787, dataDir: '/d' })).toEqual({ type: 'ready', url: SERVER, port: 8787, dataDir: '/d' });
    expect(parseServerMessage({ type: 'error', message: 'x' })).toEqual({ type: 'error', message: 'x' });
    expect(parseServerMessage({ type: 'ready', url: SERVER })).toBeNull();
    expect(parseServerMessage('ready')).toBeNull();
    expect(parseServerMessage(null)).toBeNull();
  });
});

describe('服务重启后的页面地址', () => {
  const NEW = 'http://127.0.0.1:8790';
  it('保留前端页面路径与查询参数，换到新端口', () => {
    expect(restoredUrl('http://127.0.0.1:8787/history?status=failed#x', NEW)).toBe('http://127.0.0.1:8790/history?status=failed#x');
    expect(restoredUrl('http://127.0.0.1:8787/', NEW)).toBe('http://127.0.0.1:8790/');
  });
  it('下载、接口、MCP、静态资源地址回首页', () => {
    for (const p of ['/files/2026-10-08/a/00.png?download=1', '/api/tasks', '/mcp', '/assets/index.js']) expect(restoredUrl(`http://127.0.0.1:8787${p}`, NEW)).toBe(`${NEW}/`);
  });
  it('// 开头的路径不会变成外部地址', () => {
    for (const p of ['//evil.com/x', '/.//evil.com/x', '/..//evil.com/y']) {
      const r = restoredUrl(`http://127.0.0.1:8787${p}`, NEW);
      expect(new URL(r).origin).toBe(NEW);
    }
  });
  it('解析不了的地址回首页', () => {
    expect(restoredUrl('', NEW)).toBe(`${NEW}/`);
    expect(restoredUrl('chrome-error://chromewebdata/', NEW)).toBe(`${NEW}/`);
  });
});

describe('上次使用的端口', () => {
  it('只接受合法端口', () => {
    expect(parseSavedPort('{"port":8788}')).toBe(8788);
    for (const t of ['{"port":0}', '{"port":70000}', '{"port":"8788"}', '{"port":87.5}', '{}', 'not json', '']) expect(parseSavedPort(t)).toBeUndefined();
  });
});
