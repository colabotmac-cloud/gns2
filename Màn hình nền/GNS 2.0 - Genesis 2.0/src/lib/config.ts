import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gns2');
const AGENTS_DIR = path.join(CONFIG_DIR, 'agents');
const GLOBAL_CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GlobalConfig {
  port: number;         // Port web UI, default 8823
  adminUser: string;    // Username đăng nhập web
  adminHash: string;    // Bcrypt hash của password
  jwtSecret: string;    // Secret để ký JWT token
}

export interface AgentProfile {
  name: string;                    // Tên agent, dùng làm tên file
  cli: 'claude' | 'gemini';        // Dùng AI nào
  botToken: string;                // Telegram bot token
  allowedUsers: number[];          // Danh sách Telegram user ID được phép nhắn
  sessionId: string;               // UUID cố định, không đổi trừ khi /new
  workingDir?: string;             // Thư mục làm việc (Claude cần để tìm session file)
  maxTurns?: number;               // Giới hạn lượt xử lý mỗi tin nhắn (Claude only)
  timeoutMs?: number;              // Timeout chờ AI trả lời, default 3 phút
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDirs() {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
}

// ─── Global Config ────────────────────────────────────────────────────────────

export function globalConfigExists(): boolean {
  return fs.existsSync(GLOBAL_CONFIG_FILE);
}

export function loadGlobalConfig(): GlobalConfig {
  if (!fs.existsSync(GLOBAL_CONFIG_FILE)) {
    throw new Error(`Chưa setup. Chạy: npm run setup`);
  }
  return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
}

export function saveGlobalConfig(config: GlobalConfig) {
  ensureDirs();
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  fs.chmodSync(GLOBAL_CONFIG_FILE, 0o600); // Chỉ owner đọc được
}

// Tạo global config mặc định (dùng trong setup)
export function createDefaultGlobalConfig(adminUser: string, adminHash: string): GlobalConfig {
  return {
    port: 8823,
    adminUser,
    adminHash,
    jwtSecret: crypto.randomBytes(48).toString('hex'),
  };
}

// ─── Agent Profiles ──────────────────────────────────────────────────────────

export function listAgents(): AgentProfile[] {
  ensureDirs();
  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    return JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf-8')) as AgentProfile;
  });
}

export function loadAgent(name: string): AgentProfile | null {
  const file = path.join(AGENTS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function saveAgent(profile: AgentProfile) {
  ensureDirs();
  const file = path.join(AGENTS_DIR, `${profile.name}.json`);
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf-8');
  fs.chmodSync(file, 0o600);
}

export function deleteAgent(name: string) {
  const file = path.join(AGENTS_DIR, `${name}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ─── Kiểm tra CLI có sẵn trên máy không ──────────────────────────────────────

export interface CliCheckResult {
  claude: boolean;
  gemini: boolean;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function checkAvailableClis(): CliCheckResult {
  return {
    claude: commandExists('claude'),
    gemini: commandExists('gemini'),
  };
}

// Dùng trong install.sh / setup — dừng nếu không có CLI nào
export function assertCliAvailable(cli: 'claude' | 'gemini') {
  const available = checkAvailableClis();
  if (!available[cli]) {
    const instructions: Record<string, string> = {
      claude: 'npm install -g @anthropic-ai/claude-code\nSau đó chạy: claude   (để đăng nhập lần đầu)',
      gemini: 'npm install -g @google/gemini-cli\nSau đó chạy: gemini   (để đăng nhập lần đầu)',
    };
    throw new Error(
      `❌ Không tìm thấy "${cli}" trên máy này.\n` +
      `Cài trước bằng lệnh:\n\n${instructions[cli]}\n`
    );
  }
}
