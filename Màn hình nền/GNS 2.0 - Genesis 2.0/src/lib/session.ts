import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentProfile } from './config.js';

const GNS_SESSION_DIR = path.join(os.homedir(), '.config', 'gns2', 'sessions');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  ts: string; // ISO timestamp
}

export interface SessionStats {
  messageCount: number;
  fileSizeBytes: number;
}

// ─── Claude Session ───────────────────────────────────────────────────────────
// Claude tự quản lý session file tại ~/.claude/projects/{key}/{sessionId}.jsonl
// Key = workingDir với '/' đổi thành '-'

export function getClaudeSessionPath(profile: AgentProfile): string {
  const workingDir = profile.workingDir ?? os.homedir();
  const key = workingDir.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', key, `${profile.sessionId}.jsonl`);
}

export function claudeSessionExists(profile: AgentProfile): boolean {
  return fs.existsSync(getClaudeSessionPath(profile));
}

// Đọc stats từ file JSONL của Claude
export function getClaudeSessionStats(profile: AgentProfile): SessionStats {
  const filePath = getClaudeSessionPath(profile);
  if (!fs.existsSync(filePath)) return { messageCount: 0, fileSizeBytes: 0 };

  const content = fs.readFileSync(filePath, 'utf-8');
  const fileSizeBytes = Buffer.byteLength(content, 'utf-8');

  // Đếm số dòng là user/assistant message (bỏ qua các dòng metadata)
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

// ─── Gemini Session ───────────────────────────────────────────────────────────
// Gemini stateless → tự duy trì file lịch sử JSONL riêng

function getGeminiSessionDir(profile: AgentProfile): string {
  return path.join(GNS_SESSION_DIR, profile.name);
}

export function getGeminiHistoryPath(profile: AgentProfile): string {
  return path.join(getGeminiSessionDir(profile), `${profile.sessionId}.jsonl`);
}

export function loadGeminiHistory(profile: AgentProfile): Message[] {
  const filePath = getGeminiHistoryPath(profile);
  if (!fs.existsSync(filePath)) return [];

  const messages: Message[] = [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch { /* bỏ qua */ }
  }
  return messages;
}

export function appendGeminiHistory(profile: AgentProfile, role: 'user' | 'assistant', content: string) {
  const dir = getGeminiSessionDir(profile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const message: Message = { role, content, ts: new Date().toISOString() };
  fs.appendFileSync(getGeminiHistoryPath(profile), JSON.stringify(message) + '\n', 'utf-8');
}

export function getGeminiSessionStats(profile: AgentProfile): SessionStats {
  const filePath = getGeminiHistoryPath(profile);
  if (!fs.existsSync(filePath)) return { messageCount: 0, fileSizeBytes: 0 };

  const content = fs.readFileSync(filePath, 'utf-8');
  const fileSizeBytes = Buffer.byteLength(content, 'utf-8');
  const messageCount = content.split('\n').filter(l => l.trim()).length;
  return { messageCount, fileSizeBytes };
}

// Xóa file lịch sử Gemini (dùng khi /new)
export function clearGeminiHistory(profile: AgentProfile) {
  const filePath = getGeminiHistoryPath(profile);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ─── Unified Stats ────────────────────────────────────────────────────────────

export function getSessionStats(profile: AgentProfile): SessionStats {
  return profile.cli === 'claude'
    ? getClaudeSessionStats(profile)
    : getGeminiSessionStats(profile);
}
