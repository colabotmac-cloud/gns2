import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentProfile } from './config.js';
import { getClaudeSessionPath, getGeminiHistoryPath, getSessionStats, type Message } from './session.js';

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
  createdAt: string;   // Lấy từ tên file
  sizeBytes: number;
  filePath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Định dạng thời gian Việt Nam cho tên file
function vnDatetime(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  const h = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}_${h}-${mi}`;
}

// Tên file backup theo chuẩn đã chốt
// {AgentName}_{8 ký tự sessionId}_{YYYY-MM-DD_HH-mm}.md
function buildFilename(profile: AgentProfile): string {
  const shortSession = profile.sessionId.replace(/-/g, '').substring(0, 8);
  const datetime = vnDatetime(new Date());
  return `${profile.name}_${shortSession}_${datetime}.md`;
}

// ─── Kiểm tra có cần backup không ────────────────────────────────────────────

export function shouldBackup(profile: AgentProfile): boolean {
  const stats = getSessionStats(profile);
  return (
    stats.messageCount >= BACKUP_THRESHOLD_MESSAGES ||
    stats.fileSizeBytes >= BACKUP_THRESHOLD_BYTES
  );
}

// ─── Chuyển Claude JSONL → danh sách Message ─────────────────────────────────

function parseClaudeSession(filePath: string): Message[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const messages: Message[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user' && entry.type !== 'assistant') continue;
      if (!entry.message) continue;

      const role = entry.message.role as 'user' | 'assistant';
      const msgContent = entry.message.content;
      let content = '';

      if (typeof msgContent === 'string') {
        content = msgContent;
      } else if (Array.isArray(msgContent)) {
        content = msgContent
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('\n');
      }

      if (content.trim()) {
        messages.push({
          role,
          content: content.trim(),
          ts: entry.timestamp ?? new Date().toISOString(),
        });
      }
    } catch { /* bỏ qua dòng lỗi */ }
  }
  return messages;
}

// ─── Chuyển danh sách Message → Markdown ─────────────────────────────────────

function messagesToMarkdown(profile: AgentProfile, messages: Message[]): string {
  const stats = getSessionStats(profile);
  const now = vnDatetime(new Date());

  let md = `# Backup: ${profile.name} | ${profile.sessionId.substring(0, 8)} | ${now.replace('_', ' ').replace('-', ':')}\n`;
  md += `> Agent: **${profile.name}** | CLI: **${profile.cli}** | Số tin nhắn: **${stats.messageCount}**\n\n`;
  md += `---\n\n`;

  messages.forEach((msg, i) => {
    const time = new Date(msg.ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const label = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
    md += `## [${i + 1}] ${label} — ${time}\n\n`;
    md += `${msg.content}\n\n`;
    md += `---\n\n`;
  });

  return md;
}

// ─── Thực hiện backup ────────────────────────────────────────────────────────

export function backupSession(profile: AgentProfile): string {
  // Đảm bảo thư mục tồn tại
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Lấy messages theo từng loại CLI
  let messages: Message[];
  if (profile.cli === 'claude') {
    const sessionFile = getClaudeSessionPath(profile);
    messages = parseClaudeSession(sessionFile);
  } else {
    const historyFile = getGeminiHistoryPath(profile);
    if (!fs.existsSync(historyFile)) return '';
    const lines = fs.readFileSync(historyFile, 'utf-8').split('\n');
    messages = lines
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as Message);
  }

  if (messages.length === 0) return '';

  // Tạo file backup
  const filename = buildFilename(profile);
  const filePath = path.join(BACKUP_DIR, filename);
  const markdown = messagesToMarkdown(profile, messages);
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
      // Tên file: agentName_sessionId_datetime.md
      const agentName = f.split('_')[0];
      return {
        filename: f,
        agentName,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        filePath,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // Mới nhất lên đầu
}

export function readBackup(filename: string): string {
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Không tìm thấy file: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}
