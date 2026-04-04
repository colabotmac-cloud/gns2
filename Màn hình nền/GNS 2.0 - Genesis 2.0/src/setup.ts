import readline from 'readline';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import net from 'net';
import {
  checkAvailableClis,
  globalConfigExists,
  saveGlobalConfig,
  saveAiAgent,
  saveWorker,
  createDefaultGlobalConfig,
  AgentInstance,
  WorkerInstance,
} from './lib/config.js';

// Tìm port trống bắt đầu từ startPort
function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(startPort + 1)));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function askDefault(question: string, defaultValue: string): Promise<string> {
  return new Promise(resolve =>
    rl.question(`${question} [${defaultValue}]: `, answer => {
      const val = answer.trim();
      resolve(val === '' ? defaultValue : val);
    })
  );
}

function separator() {
  console.log('\n' + '─'.repeat(50) + '\n');
}

// ─── Main setup ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\nGNS 2.0 — Setup Wizard\n');

  // ── Bước 1: Kiểm tra CLI có sẵn ────────────────────────────────────────
  separator();
  console.log('Bước 1: Kiểm tra CLI đã cài...\n');

  const clis = checkAvailableClis();
  const available: Array<'claude-cli' | 'gemini-cli'> = [];

  if (clis.claude) {
    console.log('  claude   — đã cài');
    available.push('claude-cli');
  } else {
    console.log('  claude   — chưa cài (npm install -g @anthropic-ai/claude-code)');
  }

  if (clis.gemini) {
    console.log('  gemini   — đã cài');
    available.push('gemini-cli');
  } else {
    console.log('  gemini   — chưa cài (npm install -g @google/gemini-cli)');
  }

  if (available.length === 0) {
    console.error('\nKhông có CLI nào. Cài ít nhất 1 trong 2 trước khi setup.\n');
    rl.close();
    process.exit(1);
  }

  // ── Bước 2: Web UI config ───────────────────────────────────────────────
  separator();
  console.log('Bước 2: Cấu hình Web UI\n');

  const suggestedPort = await findFreePort(8823);
  if (suggestedPort !== 8823) {
    console.log(`  Port 8823 đang bận → tự chọn port ${suggestedPort}`);
  }

  const portStr = await askDefault('Port cho web UI', String(suggestedPort));
  let port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1024 || port > 65535) {
    console.error('Port không hợp lệ (1024–65535)');
    rl.close();
    process.exit(1);
  }

  const actualPort = await findFreePort(port);
  if (actualPort !== port) {
    console.log(`  Port ${port} đang bận → tự dùng port ${actualPort}`);
    port = actualPort;
  }

  const adminUser = await askDefault('Username đăng nhập', 'admin');

  let password = '';
  while (password.length < 6) {
    password = await ask('Password (ít nhất 6 ký tự): ');
    if (password.length < 6) console.log('  Password quá ngắn.');
  }

  const adminHash = await bcrypt.hash(password, 10);
  const config = createDefaultGlobalConfig(adminUser, adminHash);
  config.port = port;
  saveGlobalConfig(config);
  console.log('\n  Đã lưu cấu hình web UI.');

  // ── Bước 3: Tạo AI Agent đầu tiên ──────────────────────────────────────
  separator();
  console.log('Bước 3: Tạo AI Agent đầu tiên\n');

  const createFirst = await ask('Tạo AI Agent và Worker đầu tiên ngay bây giờ? (y/n): ');
  let agentId: string | null = null;

  if (createFirst.toLowerCase() === 'y') {
    agentId = await createAgentStep(available);
  } else {
    console.log('\n  Bỏ qua. Tạo sau bằng Web UI.');
  }

  // ── Bước 4: Tạo Worker đầu tiên ────────────────────────────────────────
  if (agentId) {
    separator();
    console.log('Bước 4: Tạo Worker (Telegram Bot) đầu tiên\n');
    await createWorkerStep(agentId);
  }

  // ── Xong ───────────────────────────────────────────────────────────────
  separator();
  console.log('Setup hoàn tất!\n');
  console.log('  Khởi động hệ thống:   npm start');
  console.log(`  Mở Web UI:            http://localhost:${port}`);
  console.log(`  Đăng nhập:            ${adminUser} / [password vừa đặt]\n`);

  rl.close();
}

async function createAgentStep(available: Array<'claude-cli' | 'gemini-cli'>): Promise<string | null> {
  const name = await ask('Tên AI Agent: ');
  if (!name) {
    console.log('  Bỏ qua tạo agent.');
    return null;
  }

  let type: 'claude-cli' | 'gemini-cli';
  if (available.length === 1) {
    type = available[0];
    console.log(`  Loại: ${type} (duy nhất trên máy này)`);
  } else {
    const typeStr = await ask('Loại AI (claude-cli/gemini-cli): ');
    if (typeStr !== 'claude-cli' && typeStr !== 'gemini-cli') {
      console.error('  Chỉ nhập "claude-cli" hoặc "gemini-cli"');
      return null;
    }
    if (!available.includes(typeStr)) {
      console.error(`  "${typeStr}" chưa được cài trên máy này.`);
      return null;
    }
    type = typeStr;
  }

  const defaultModel = type === 'claude-cli' ? 'claude-sonnet-4-5' : 'gemini-2.5-pro';
  const agent: AgentInstance = {
    id: crypto.randomUUID(),
    name,
    type,
    model: defaultModel,
    sessionId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  saveAiAgent(agent);
  console.log(`\n  Đã tạo AI Agent "${name}" (${type})`);
  console.log(`  ID: ${agent.id}`);
  return agent.id;
}

async function createWorkerStep(agentId: string): Promise<void> {
  const name = await ask('Tên Worker (Telegram bot): ');
  if (!name) {
    console.log('  Bỏ qua tạo worker.');
    return;
  }

  const botToken = await ask('Telegram Bot Token (từ @BotFather): ');
  if (!botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    console.error('  Token không đúng định dạng');
    return;
  }

  const userIdsStr = await ask('Telegram User ID được phép nhắn (phân cách bằng dấu phẩy): ');
  const allowedUsers = userIdsStr
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  if (allowedUsers.length === 0) {
    console.error('  Cần ít nhất 1 User ID.');
    return;
  }

  const systemPrompt = await ask('System Prompt (có thể để trống): ');

  let pin = '';
  while (pin.length < 4) {
    pin = await ask('PIN để /clearhistory (ít nhất 4 ký tự): ');
    if (pin.length < 4) console.log('  PIN quá ngắn.');
  }

  const sessionPin = await bcrypt.hash(pin, 10);

  const worker: WorkerInstance = {
    id: crypto.randomUUID(),
    name,
    botToken,
    allowedUsers,
    systemPrompt,
    sessionPin,
    activeAgentId: agentId,
    conversationLog: [],
    createdAt: new Date().toISOString(),
  };

  saveWorker(worker);
  console.log(`\n  Đã tạo Worker "${name}"`);
  console.log(`  ID: ${worker.id}`);
}

main().catch(err => {
  console.error('Lỗi:', err.message || err);
  rl.close();
  process.exit(1);
});
