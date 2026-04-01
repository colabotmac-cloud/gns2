import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadGlobalConfig, globalConfigExists } from './lib/config.js';
import { startWebServer } from './web/server.js';
import { manager } from './bot/manager.js';
import { log, logError } from './lib/logger.js';

const PID_FILE = path.join(os.homedir(), '.config', 'gns2', 'gns2.pid');

function killOldInstance(): Promise<void> {
  return new Promise(resolve => {
    if (!fs.existsSync(PID_FILE)) { resolve(); return; }
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (oldPid && oldPid !== process.pid) {
        process.kill(oldPid, 'SIGTERM');
        console.log(`[main] Đã dừng instance cũ (PID ${oldPid})`);
        // Poll cho tới khi process chết, tối đa 4s
        let waited = 0;
        const interval = setInterval(() => {
          waited += 100;
          let alive = true;
          try { process.kill(oldPid, 0); } catch { alive = false; }
          if (!alive || waited >= 4000) {
            clearInterval(interval);
            // Thêm 300ms để OS release port
            setTimeout(() => { resolve(); }, 300);
          }
        }, 100);
        return;
      }
    } catch { /* process cũ đã thoát rồi */ }
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    resolve();
  });
}

function writePid() {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}

function cleanupPid() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

async function main() {
  // ── Kill instance cũ nếu có ─────────────────────────────────────────────
  await killOldInstance();
  writePid();

  // ── Kiểm tra đã setup chưa ──────────────────────────────────────────────
  if (!globalConfigExists()) {
    console.error('❌ Chưa setup. Chạy lệnh sau để bắt đầu:');
    console.error('   npm run setup');
    process.exit(1);
  }

  const config = loadGlobalConfig();

  // ── Khởi động web server ────────────────────────────────────────────────
  const port = await startWebServer();
  log('main', `Web UI: http://localhost:${port}`);

  // ── Khởi động tất cả bots ───────────────────────────────────────────────
  manager.startAll();

  // ── Graceful shutdown ───────────────────────────────────────────────────
  async function shutdown(signal: string) {
    log('main', `Nhận tín hiệu ${signal}, đang dừng...`);
    cleanupPid();
    try {
      await manager.stopAll();
      log('main', 'Đã dừng tất cả agents.');
    } catch (err) {
      logError('main', `Lỗi khi dừng: ${err}`);
    }
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log('main', 'GNS 2.0 đang chạy. Bấm Ctrl+C để dừng.');
}

main().catch(err => {
  console.error('❌ Lỗi khởi động:', err.message || err);
  process.exit(1);
});
