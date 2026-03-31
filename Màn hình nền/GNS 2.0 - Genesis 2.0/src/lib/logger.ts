import fs from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.config', 'gns2', 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function timestamp(): string {
  const now = new Date();
  // Chuyển sang giờ Việt Nam (UTC+7)
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  const h = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  const s = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function write(agentName: string, level: 'INFO' | 'ERROR', message: string) {
  ensureLogDir();
  const line = `[${timestamp()}] [${level}] ${message}\n`;
  const logFile = path.join(LOG_DIR, `${agentName}.log`);
  fs.appendFileSync(logFile, line, 'utf-8');
  // Cũng in ra console để dễ debug khi chạy trực tiếp
  console.log(`[${agentName}] ${line.trim()}`);
}

export function log(agentName: string, message: string) {
  write(agentName, 'INFO', message);
}

export function logError(agentName: string, message: string) {
  write(agentName, 'ERROR', message);
}

// Đọc N dòng cuối của log (dùng cho web UI)
export function readLog(agentName: string, lines = 50): string[] {
  const logFile = path.join(LOG_DIR, `${agentName}.log`);
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf-8');
  const all = content.split('\n').filter(l => l.trim());
  return all.slice(-lines);
}
