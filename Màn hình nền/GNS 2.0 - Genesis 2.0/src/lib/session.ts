import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentInstance, WorkerInstance, LogEntry } from './config.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionStats {
  messageCount: number;
  fileSizeBytes: number;
}

// ─── Claude Session ───────────────────────────────────────────────────────────
// Claude tự quản lý session file tại ~/.claude/projects/{key}/{sessionId}.jsonl
// Key = workingDir với '/' đổi thành '-'

export function getClaudeSessionPath(agent: AgentInstance, workingDir?: string): string {
  const wd = workingDir ?? os.homedir();
  const key = wd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', key, `${agent.sessionId}.jsonl`);
}

export function claudeSessionExists(agent: AgentInstance, workingDir?: string): boolean {
  return fs.existsSync(getClaudeSessionPath(agent, workingDir));
}

export function getClaudeSessionStats(agent: AgentInstance): SessionStats {
  const filePath = getClaudeSessionPath(agent);
  if (!fs.existsSync(filePath)) return { messageCount: 0, fileSizeBytes: 0 };

  const content = fs.readFileSync(filePath, 'utf-8');
  const fileSizeBytes = Buffer.byteLength(content, 'utf-8');

  let messageCount = 0;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' || entry.type === 'assistant') messageCount++;
    } catch { /* bỏ qua dòng lỗi */ }
  }

  return { messageCount, fileSizeBytes };
}

// ─── Neutral Log Helpers (operate on WorkerInstance in memory) ───────────────

export function appendToLog(worker: WorkerInstance, role: 'user' | 'assistant', content: string, agentId: string): void {
  const entry: LogEntry = {
    role,
    content,
    timestamp: new Date().toISOString(),
    agentId,
  };
  worker.conversationLog.push(entry);
}

export function getRecentLog(worker: WorkerInstance, turns: number): LogEntry[] {
  // 1 turn = 1 user + 1 assistant = 2 entries
  return worker.conversationLog.slice(-(turns * 2));
}

export function clearLog(worker: WorkerInstance): void {
  worker.conversationLog = [];
}

export function getLogStats(worker: WorkerInstance): SessionStats {
  const content = JSON.stringify(worker.conversationLog);
  return {
    messageCount: worker.conversationLog.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
  };
}
