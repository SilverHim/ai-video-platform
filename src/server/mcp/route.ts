import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import * as registry from '../../shared/providers/registry.js';
import type { AppDeps } from '../app.js';
import type { Catalog } from '../tasks/task-service.js';
import type { McpTokenStore } from './token.js';
import { registerTools } from './tools.js';

/**
 * /mcp：MCP Streamable HTTP（官方 SDK v2，legacy:'stateless' 兼容 2025 代客户端握手）。
 * Host / Origin 由 local-guard 校验；这里再校验本机访问令牌。
 */
export function mcpRoutes(deps: AppDeps & { mcpToken: McpTokenStore; catalog?: Catalog }) {
  const catalog = deps.catalog ?? registry;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'ai-video-platform', version: deps.version });
      registerTools(server, deps, catalog);
      return server;
    },
    {
      legacy: 'stateless',
      // 新协议（2026-07-28）也一律用 SSE 流式响应：响应头立即发出、每 15 秒保活，进度通知能实时送达。
      // 默认 'auto' 在工具出结果前不发任何字节，长时间的工具会撞上客户端「等第一个字节」的超时（Claude Code 默认 60 秒）
      responseMode: 'sse',
      maxRequestBodySize: 8 * 1024 * 1024,
      onerror: (e) => console.error('[mcp]', e.message),
    },
  );
  const app = new Hono();
  app.all('/', async (c) => {
    if (!deps.mcpToken.verify(c.req.header('authorization'))) {
      return c.json({ error: 'unauthorized', message: '缺少或错误的 MCP 访问令牌（设置页可复制接入命令）' }, 401, { 'WWW-Authenticate': 'Bearer realm="ai-video-platform"' });
    }
    return handler.fetch(c.req.raw);
  });
  return app;
}
