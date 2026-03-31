import { loadGlobalConfig, globalConfigExists } from './lib/config.js';
import { startWebServer } from './web/server.js';
import { manager } from './bot/manager.js';
import { log, logError } from './lib/logger.js';

async function main() {
  // ── Kiểm tra đã setup chưa ──────────────────────────────────────────────
  if (!globalConfigExists()) {
    console.error('❌ Chưa setup. Chạy lệnh sau để bắt đầu:');
    console.error('   npm run setup');
    process.exit(1);
  }

  const config = loadGlobalConfig();

  // ── Khởi động web server ────────────────────────────────────────────────
  startWebServer();
  log('main', `Web UI: http://localhost:${config.port}`);

  // ── Khởi động tất cả bots ───────────────────────────────────────────────
  manager.startAll();

  // ── Graceful shutdown ───────────────────────────────────────────────────
  async function shutdown(signal: string) {
    log('main', `Nhận tín hiệu ${signal}, đang dừng...`);
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
