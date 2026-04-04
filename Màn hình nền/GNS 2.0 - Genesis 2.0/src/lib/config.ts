import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gns2');
const AI_AGENTS_DIR = path.join(CONFIG_DIR, 'ai-agents');
const WORKERS_DIR = path.join(CONFIG_DIR, 'workers');
const GLOBAL_CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GlobalConfig {
  port: number;
  adminUser: string;
  adminHash: string;
  jwtSecret: string;
}

export interface AgentInstance {
  id: string;           // uuid
  name: string;         // display name
  type: 'claude-cli' | 'gemini-cli';
  model: string;        // e.g. claude-sonnet-4-5 / gemini-2.5-pro
  sessionId: string;    // Claude --resume ID (created at Agent creation time)
  createdAt: string;
}

export interface LogEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  agentId: string;
}

export interface WorkerInstance {
  id: string;           // uuid
  name: string;
  botToken: string;
  allowedUsers: number[];
  systemPrompt: string;
  sessionPin: string;   // bcrypt hash of PIN
  activeAgentId: string;
  conversationLog: LogEntry[];
  handoffContext?: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDirs() {
  if (!fs.existsSync(AI_AGENTS_DIR)) {
    fs.mkdirSync(AI_AGENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(WORKERS_DIR)) {
    fs.mkdirSync(WORKERS_DIR, { recursive: true });
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
  fs.chmodSync(GLOBAL_CONFIG_FILE, 0o600);
}

export function createDefaultGlobalConfig(adminUser: string, adminHash: string): GlobalConfig {
  return {
    port: 8823,
    adminUser,
    adminHash,
    jwtSecret: crypto.randomBytes(48).toString('hex'),
  };
}

// ─── AI Agent CRUD ───────────────────────────────────────────────────────────

export function listAiAgents(): AgentInstance[] {
  ensureDirs();
  const files = fs.readdirSync(AI_AGENTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    return JSON.parse(fs.readFileSync(path.join(AI_AGENTS_DIR, f), 'utf-8')) as AgentInstance;
  });
}

export function loadAiAgent(id: string): AgentInstance | null {
  const file = path.join(AI_AGENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function saveAiAgent(agent: AgentInstance): void {
  ensureDirs();
  const file = path.join(AI_AGENTS_DIR, `${agent.id}.json`);
  fs.writeFileSync(file, JSON.stringify(agent, null, 2), 'utf-8');
  fs.chmodSync(file, 0o600);
}

export function deleteAiAgent(id: string): void {
  const file = path.join(AI_AGENTS_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ─── Worker CRUD ─────────────────────────────────────────────────────────────

export function listWorkers(): WorkerInstance[] {
  ensureDirs();
  const files = fs.readdirSync(WORKERS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    return JSON.parse(fs.readFileSync(path.join(WORKERS_DIR, f), 'utf-8')) as WorkerInstance;
  });
}

export function loadWorker(id: string): WorkerInstance | null {
  const file = path.join(WORKERS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function saveWorker(worker: WorkerInstance): void {
  ensureDirs();
  const file = path.join(WORKERS_DIR, `${worker.id}.json`);
  fs.writeFileSync(file, JSON.stringify(worker, null, 2), 'utf-8');
  fs.chmodSync(file, 0o600);
}

export function deleteWorker(id: string): void {
  const file = path.join(WORKERS_DIR, `${id}.json`);
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

export function assertCliAvailable(cli: 'claude' | 'gemini') {
  const available = checkAvailableClis();
  if (!available[cli]) {
    const instructions: Record<string, string> = {
      claude: 'npm install -g @anthropic-ai/claude-code\nSau đó chạy: claude   (để đăng nhập lần đầu)',
      gemini: 'npm install -g @google/gemini-cli\nSau đó chạy: gemini   (để đăng nhập lần đầu)',
    };
    throw new Error(
      `Không tìm thấy "${cli}" trên máy này.\n` +
      `Cài trước bằng lệnh:\n\n${instructions[cli]}\n`
    );
  }
}
