import readline from 'readline';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import net from 'net';
import {
  checkAvailableClis,
  globalConfigExists,
  saveGlobalConfig,
  saveAgent,
  createDefaultGlobalConfig,
  AgentProfile,
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
  console.log('\n🚀 GNS 2.0 — Setup Wizard\n');

  // ── Bước 1: Kiểm tra CLI có sẵn ────────────────────────────────────────
  separator();
  console.log('📋 Bước 1: Kiểm tra CLI đã cài...\n');

  const clis = checkAvailableClis();
  const available: Array<'claude' | 'gemini'> = [];

  if (clis.claude) {
    console.log('  ✅ claude   — đã cài');
    available.push('claude');
  } else {
    console.log('  ❌ claude   — chưa cài (npm install -g @anthropic-ai/claude-code)');
  }

  if (clis.gemini) {
    console.log('  ✅ gemini   — đã cài');
    available.push('gemini');
  } else {
    console.log('  ❌ gemini   — chưa cài (npm install -g @google/gemini-cli)');
  }

  if (available.length === 0) {
    console.error('\n❌ Không có CLI nào. Cài ít nhất 1 trong 2 trước khi setup.\n');
    rl.close();
    process.exit(1);
  }

  // ── Bước 2: Web UI config ───────────────────────────────────────────────
  separator();
  console.log('🌐 Bước 2: Cấu hình Web UI\n');

  // Tự detect port trống
  const suggestedPort = await findFreePort(8823);
  if (suggestedPort !== 8823) {
    console.log(`  ℹ️  Port 8823 đang bận → tự chọn port ${suggestedPort}`);
  }

  const portStr = await askDefault('Port cho web UI', String(suggestedPort));
  let port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1024 || port > 65535) {
    console.error('❌ Port không hợp lệ (1024–65535)');
    rl.close();
    process.exit(1);
  }

  // Verify port vừa nhập có trống không
  const actualPort = await findFreePort(port);
  if (actualPort !== port) {
    console.log(`  ⚠️  Port ${port} đang bận → tự dùng port ${actualPort}`);
    port = actualPort;
  }

  const adminUser = await askDefault('Username đăng nhập', 'admin');

  let password = '';
  while (password.length < 6) {
    password = await ask('Password (ít nhất 6 ký tự): ');
    if (password.length < 6) console.log('  ⚠️  Password quá ngắn.');
  }

  const adminHash = await bcrypt.hash(password, 10);
  const config = createDefaultGlobalConfig(adminUser, adminHash);
  config.port = port;
  saveGlobalConfig(config);
  console.log('\n  ✅ Đã lưu cấu hình web UI.');

  // ── Bước 3: Tạo agent đầu tiên ──────────────────────────────────────────
  separator();
  console.log('🤖 Bước 3: Tạo agent đầu tiên\n');

  const createFirst = await ask('Tạo agent đầu tiên ngay bây giờ? (y/n): ');
  if (createFirst.toLowerCase() === 'y') {
    await createAgent(available);
  } else {
    console.log('\n  Bỏ qua. Tạo agent sau bằng Web UI hoặc chạy lại setup.');
  }

  // ── Xong ───────────────────────────────────────────────────────────────
  separator();
  console.log('✅ Setup hoàn tất!\n');
  console.log('  Khởi động hệ thống:   npm start');
  console.log(`  Mở Web UI:            http://localhost:${port}`);
  console.log(`  Đăng nhập:            ${adminUser} / [password vừa đặt]\n`);

  rl.close();
}

async function createAgent(available: Array<'claude' | 'gemini'>) {
  const name = await ask('Tên agent (không dấu, không cách): ');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.error('❌ Tên không hợp lệ. Chỉ dùng a-z, 0-9, _, -');
    return;
  }

  let cli: 'claude' | 'gemini';
  if (available.length === 1) {
    cli = available[0];
    console.log(`  CLI: ${cli} (duy nhất trên máy này)`);
  } else {
    const cliStr = await ask('CLI (claude/gemini): ');
    if (cliStr !== 'claude' && cliStr !== 'gemini') {
      console.error('❌ Chỉ nhập "claude" hoặc "gemini"');
      return;
    }
    if (!available.includes(cliStr)) {
      console.error(`❌ "${cliStr}" chưa được cài trên máy này.`);
      return;
    }
    cli = cliStr;
  }

  const botToken = await ask('Telegram Bot Token (từ @BotFather): ');
  if (!botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    console.error('❌ Token không đúng định dạng');
    return;
  }

  const userIdsStr = await ask('Telegram User ID được phép nhắn (phân cách bằng dấu phẩy): ');
  const allowedUsers = userIdsStr
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  if (allowedUsers.length === 0) {
    console.error('❌ Cần ít nhất 1 User ID. Tìm ID của bạn bằng cách nhắn @userinfobot trên Telegram.');
    return;
  }

  const profile: AgentProfile = {
    name,
    cli,
    botToken,
    allowedUsers,
    sessionId: crypto.randomUUID(),
  };

  saveAgent(profile);
  console.log(`\n  ✅ Đã tạo agent "${name}" (${cli})`);
  console.log(`  Session ID: ${profile.sessionId}`);
}

main().catch(err => {
  console.error('❌ Lỗi:', err.message || err);
  rl.close();
  process.exit(1);
});
