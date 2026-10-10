import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import * as registry from '../../shared/providers/registry.js';
import type { AppDeps } from '../app.js';
import type { Catalog } from '../tasks/task-service.js';
import type { McpTokenStore } from './token.js';
import { registerTools } from './tools.js';

/** 连接时给 agent 的使用说明（Claude Code 会放进模型上下文） */
export const MCP_INSTRUCTIONS = [
  'AI视频生成平台（本机）：用 BytePlus Seedream / Seedance、MiniMax image-01 / H3 生成图片和视频，结果保存在本机。',
  '写提示词前先用 get_model_schema 看模型的 prompt_guides（BytePlus 官方提示词指南要点）以及各模式的 prompt.hint、reference_syntax。Seedream 5.0 pro / flash 的局部改图用 <point> / <bbox> 坐标，规则见其指南。',
  '提交前用 preview_request 检查参数、请求体和预估费用（不提交、不计费）。',
  '出图常要 1–3 分钟：generate_image 在任务创建后默认最多等 50 秒，没完成就返回 task_id，再用 get_task（可带 wait_seconds）继续等。客户端超时或断开不会取消已提交的任务，它可能仍在执行并产生费用：先用 get_task / list_tasks 查，避免重复提交。',
  'BytePlus 模型可以用 list_endpoints 找推理接入点（例如关闭了内容过滤的），再把 endpoint_id 填进 model_override。',
].join('\n');

/**
 * /mcp：MCP Streamable HTTP（官方 SDK v2，legacy:'stateless' 兼容 2025 代客户端握手）。
 * Host / Origin 由 local-guard 校验；这里再校验本机访问令牌。
 */
export function mcpRoutes(deps: AppDeps & { mcpToken: McpTokenStore; catalog?: Catalog }) {
  const catalog = deps.catalog ?? registry;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'ai-video-platform', version: deps.version }, { instructions: MCP_INSTRUCTIONS });
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
