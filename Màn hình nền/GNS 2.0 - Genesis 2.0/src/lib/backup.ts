import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentInstance, WorkerInstance, LogEntry } from './config.js';
import { getLogStats } from './session.js';

// Thư mục backup nằm trong workspace GNS 2.0
const BACKUP_DIR = path.join(
  os.homedir(),
  'Màn hình nền',
  'GNS 2.0 - Genesis 2.0',
  'session-backup'
);

// Ngưỡng trigger backup
const BACKUP_THRESHOLD_MESSAGES = 80;
const BACKUP_THRESHOLD_BYTES = 500 * 1024; // 500KB

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BackupFile {
  filename: string;
  agentName: string;
  createdAt: string;
  sizeBytes: number;
  filePath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function vnDatetime(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  const h = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}_${h}-${mi}`;
}

// {workerName}_{8chars-workerId}_{datetime}.md
function buildFilename(worker: WorkerInstance): string {
  const shortId = worker.id.replace(/-/g, '').substring(0, 8);
  const datetime = vnDatetime(new Date());
  return `${worker.name}_${shortId}_${datetime}.md`;
}

// ─── Kiểm tra có cần backup không ────────────────────────────────────────────

export function shouldBackup(worker: WorkerInstance): boolean {
  const stats = getLogStats(worker);
  return (
    stats.messageCount >= BACKUP_THRESHOLD_MESSAGES ||
    stats.fileSizeBytes >= BACKUP_THRESHOLD_BYTES
  );
}

// ─── Chuyển danh sách LogEntry → Markdown ────────────────────────────────────

function logEntriesToMarkdown(worker: WorkerInstance, agent: AgentInstance, messages: LogEntry[]): string {
  const stats = getLogStats(worker);
  const now = vnDatetime(new Date());

  let md = `# Backup: ${worker.name} | ${worker.id.substring(0, 8)} | ${now.replace('_', ' ')}\n`;
  md += `> Worker: **${worker.name}** | Agent: **${agent.name}** (${agent.type}) | Số tin nhắn: **${stats.messageCount}**\n\n`;
  md += `---\n\n`;

  messages.forEach((msg, i) => {
    const time = new Date(msg.timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const label = msg.role === 'user' ? 'User' : 'Assistant';
    md += `## [${i + 1}] ${label} — ${time}\n\n`;
    md += `${msg.content}\n\n`;
    md += `---\n\n`;
  });

  return md;
}

// ─── Thực hiện backup ────────────────────────────────────────────────────────

export function backupSession(worker: WorkerInstance, agent: AgentInstance): string {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const messages = worker.conversationLog;
  if (messages.length === 0) return '';

  const filename = buildFilename(worker);
  const filePath = path.join(BACKUP_DIR, filename);
  const markdown = logEntriesToMarkdown(worker, agent, messages);
  fs.writeFileSync(filePath, markdown, 'utf-8');

  return filePath;
}

// ─── Danh sách backup (cho web UI) ───────────────────────────────────────────

export function listBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(filePath);
      const agentName = f.split('_')[0];
      return {
        filename: f,
        agentName,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        filePath,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readBackup(filename: string): string {
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Không tìm thấy file: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}
