import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Request, Response, Express } from 'express';
import {
  listAiAgents, loadAiAgent, saveAiAgent,
  listWorkers, loadWorker, saveWorker,
  AgentInstance, WorkerInstance,
} from '../lib/config.js';
import { manager } from '../bot/manager.js';
import { getLogStats } from '../lib/session.js';
import { randomUUID } from 'crypto';

// ─── MCP Server instance ──────────────────────────────────────────────────────

const mcpServer = new McpServer({
  name: 'gns2-mcp-server',
  version: '2.0.0',
});

// ─── Tools ────────────────────────────────────────────────────────────────────

// 1. gns_list_agents
mcpServer.registerTool(
  'gns_list_agents',
  {
    title: 'List AI Agents',
    description: `Liệt kê tất cả AI Agents đã đăng ký trong GNS 2.0.

Returns: Danh sách agents với id, name, type (claude-cli|gemini-cli), model, sessionId.`,
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const agents = listAiAgents();
    const result = agents.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      model: a.model,
      sessionId: a.sessionId,
      createdAt: a.createdAt,
    }));
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// 2. gns_create_agent
mcpServer.registerTool(
  'gns_create_agent',
  {
    title: 'Create AI Agent',
    description: `Tạo AI Agent mới trong GNS 2.0.

Args:
  - name (string): Tên agent (ví dụ: "Quản Gia", "Coder Bot")
  - type ("claude-cli" | "gemini-cli"): Loại AI CLI
  - model (string, optional): Model cụ thể (ví dụ: "claude-sonnet-4-5", "gemini-2.5-pro")

Returns: Agent mới với id được tạo.`,
    inputSchema: z.object({
      name: z.string().min(1).max(50).describe('Tên agent'),
      type: z.enum(['claude-cli', 'gemini-cli']).describe('Loại AI CLI'),
      model: z.string().optional().describe('Model cụ thể (bỏ trống để dùng mặc định)'),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ name, type, model }) => {
    const defaultModel = type === 'claude-cli' ? 'claude-sonnet-4-5' : 'gemini-2.5-pro';
    const agent: AgentInstance = {
      id: randomUUID(),
      name,
      type,
      model: model || defaultModel,
      sessionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    saveAiAgent(agent);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }],
    };
  }
);

// 3. gns_list_workers
mcpServer.registerTool(
  'gns_list_workers',
  {
    title: 'List Workers',
    description: `Liệt kê tất cả Workers (Telegram/Discord bots) trong GNS 2.0 kèm trạng thái.

Returns: Danh sách workers với id, name, agentId, running (bool), messageCount.`,
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const workers = listWorkers();
    const result = workers.map(w => ({
      id: w.id,
      name: w.name,
      agentId: w.activeAgentId,
      running: manager.isWorkerRunning(w.id),
      messageCount: getLogStats(w).messageCount,
      allowedUsers: w.allowedUsers,
    }));
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// 4. gns_create_worker
mcpServer.registerTool(
  'gns_create_worker',
  {
    title: 'Create Worker',
    description: `Tạo Worker mới (Telegram bot) và liên kết với AI Agent.

Args:
  - name (string): Tên worker
  - botToken (string): Telegram Bot Token
  - agentId (string): ID của AI Agent sẽ dùng
  - allowedUsers (number[], optional): Danh sách Telegram user ID được phép dùng
  - systemPrompt (string, optional): System prompt cho bot

Returns: Worker mới với id được tạo.`,
    inputSchema: z.object({
      name: z.string().min(1).max(50).describe('Tên worker'),
      botToken: z.string().min(10).describe('Telegram Bot Token'),
      agentId: z.string().uuid().describe('ID của AI Agent'),
      allowedUsers: z.array(z.number().int()).optional().describe('Telegram user IDs được phép'),
      systemPrompt: z.string().optional().describe('System prompt cho bot'),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ name, botToken, agentId, allowedUsers, systemPrompt }) => {
    // Validate agent exists
    const agent = loadAiAgent(agentId);
    if (!agent) {
      return { content: [{ type: 'text' as const, text: `Error: Agent ID "${agentId}" không tồn tại` }] };
    }
    const worker: WorkerInstance = {
      id: randomUUID(),
      name,
      botToken,
      activeAgentId: agentId,
      allowedUsers: allowedUsers ?? [],
      systemPrompt: systemPrompt ?? '',
      sessionPin: '',
      conversationLog: [],
      createdAt: new Date().toISOString(),
    };
    saveWorker(worker);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: worker.id, name, activeAgentId: agentId }, null, 2) }],
    };
  }
);

// 5. gns_start_worker
mcpServer.registerTool(
  'gns_start_worker',
  {
    title: 'Start Worker',
    description: `Khởi động Worker (bot Telegram).

Args:
  - workerId (string): ID của worker cần start

Returns: { ok: true } nếu thành công.`,
    inputSchema: z.object({
      workerId: z.string().uuid().describe('ID của worker'),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ workerId }) => {
    try {
      manager.startWorker(workerId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, workerId }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// 6. gns_stop_worker
mcpServer.registerTool(
  'gns_stop_worker',
  {
    title: 'Stop Worker',
    description: `Dừng Worker (bot Telegram).

Args:
  - workerId (string): ID của worker cần stop

Returns: { ok: true } nếu thành công.`,
    inputSchema: z.object({
      workerId: z.string().uuid().describe('ID của worker'),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ workerId }) => {
    try {
      await manager.stopWorker(workerId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, workerId }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// 7. gns_send_message
mcpServer.registerTool(
  'gns_send_message',
  {
    title: 'Send Message to AI via Worker',
    description: `Gửi tin nhắn tới AI Agent thông qua Worker và nhận phản hồi.
Hữu ích để test bot hoặc giao tiếp trực tiếp với AI mà không cần Telegram.

Args:
  - workerId (string): ID của worker
  - message (string): Nội dung tin nhắn

Returns: { response: string } — phản hồi từ AI.`,
    inputSchema: z.object({
      workerId: z.string().uuid().describe('ID của worker'),
      message: z.string().min(1).max(4000).describe('Nội dung tin nhắn'),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ workerId, message }) => {
    try {
      const { callAI } = await import('../bot/adapters.js');
      const { appendToLog, claudeSessionExists } = await import('../lib/session.js');
      const worker = loadWorker(workerId);
      if (!worker) return { content: [{ type: 'text' as const, text: `Error: Worker "${workerId}" không tồn tại` }] };
      const agent = loadAiAgent(worker.activeAgentId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'Error: Agent không tồn tại' }] };

      const isNewSession = !claudeSessionExists(agent);
      appendToLog(worker, 'user', message, agent.id);
      const response = await callAI(agent, worker, message, isNewSession);
      appendToLog(worker, 'assistant', response, agent.id);
      saveWorker(worker);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ response }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// 8. gns_get_history
mcpServer.registerTool(
  'gns_get_history',
  {
    title: 'Get Conversation History',
    description: `Lấy lịch sử hội thoại của Worker.

Args:
  - workerId (string): ID của worker
  - limit (number, optional): Số tin nhắn gần nhất cần lấy (default: 20, max: 100)

Returns: Mảng { role, content, timestamp }`,
    inputSchema: z.object({
      workerId: z.string().uuid().describe('ID của worker'),
      limit: z.number().int().min(1).max(100).default(20).describe('Số tin nhắn gần nhất'),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ workerId, limit }) => {
    const worker = loadWorker(workerId);
    if (!worker) return { content: [{ type: 'text' as const, text: `Error: Worker "${workerId}" không tồn tại` }] };
    const history = worker.conversationLog.slice(-limit);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(history, null, 2) }],
    };
  }
);

// ─── Express route setup ──────────────────────────────────────────────────────

export function setupMcpRoutes(app: Express): void {
  // Stateless HTTP transport — mỗi request tạo transport mới
  app.post('/mcp', async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}
