import { Telegraf } from 'telegraf';
import { randomUUID } from 'crypto';
import { saveAgent, assertCliAvailable } from '../lib/config.js';
import { claudeSessionExists, clearGeminiHistory, getSessionStats } from '../lib/session.js';
import { shouldBackup, backupSession } from '../lib/backup.js';
import { log, logError } from '../lib/logger.js';
import { callAI } from './adapters.js';
import type { AgentProfile } from '../lib/config.js';

// Telegram giới hạn 1 tin nhắn tối đa 4096 ký tự
const TG_MAX_LENGTH = 4096;

export class TelegramBotService {
  private bot: Telegraf;
  private profile: AgentProfile;
  private isNewSession: boolean = false;
  private messageCount: number = 0;
  private running: boolean = false;

  constructor(profile: AgentProfile) {
    // Kiểm tra CLI có sẵn không trước khi khởi động
    assertCliAvailable(profile.cli);

    this.profile = profile;
    this.bot = new Telegraf(profile.botToken);

    // Đảm bảo có sessionId
    if (!this.profile.sessionId) {
      this.profile.sessionId = randomUUID();
      saveAgent(this.profile);
    }

    // Xác định session mới hay resume
    if (profile.cli === 'claude') {
      this.isNewSession = !claudeSessionExists(profile);
      log(profile.name, `Claude session ${profile.sessionId} — ${this.isNewSession ? 'MỚI' : 'RESUME'}`);
    } else {
      // Gemini: luôn dùng history file, không phân biệt new/resume
      this.isNewSession = false;
      const stats = getSessionStats(profile);
      log(profile.name, `Gemini session ${profile.sessionId} — ${stats.messageCount} tin nhắn trong lịch sử`);
    }

    this.registerHandlers();
  }

  // ─── Đăng ký các handler xử lý tin nhắn ───────────────────────────────────

  private registerHandlers() {
    const { name, allowedUsers } = this.profile;

    this.bot.on('message', async (ctx) => {
      const userId = ctx.from?.id;

      // Chặn user không được phép
      if (!userId || !allowedUsers.includes(userId)) return;

      const msg = ctx.message;
      if (!('text' in msg)) return;
      const text = msg.text.trim();

      // ── Xử lý các lệnh ──────────────────────────────────────────────────

      if (text === '/help') {
        await ctx.reply(
          `📋 Danh sách lệnh:\n` +
          `/new — Bắt đầu cuộc trò chuyện mới (xoá lịch sử cũ)\n` +
          `/status — Xem trạng thái hiện tại\n` +
          `/backup — Backup lịch sử ngay lập tức\n` +
          `/help — Danh sách lệnh này`
        );
        return;
      }

      if (text === '/status') {
        const stats = getSessionStats(this.profile);
        await ctx.reply(
          `📊 Trạng thái:\n` +
          `Agent: ${name}\n` +
          `CLI: ${this.profile.cli}\n` +
          `Session ID: ${this.profile.sessionId.substring(0, 8)}...\n` +
          `Tin nhắn: ${stats.messageCount}\n` +
          `Kích thước: ${(stats.fileSizeBytes / 1024).toFixed(1)} KB\n` +
          `Backup tự động khi: > 80 tin hoặc > 500 KB`
        );
        return;
      }

      if (text === '/backup') {
        await ctx.reply('⏳ Đang backup...');
        try {
          const filePath = backupSession(this.profile);
          if (filePath) {
            await ctx.reply(`✅ Backup xong!\nFile: ${filePath.split('/').pop()}`);
          } else {
            await ctx.reply('ℹ️ Chưa có tin nhắn nào để backup.');
          }
        } catch (err) {
          await ctx.reply(`❌ Backup lỗi: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      if (text === '/new') {
        // Backup trước khi reset nếu có dữ liệu
        const stats = getSessionStats(this.profile);
        if (stats.messageCount > 0) {
          try {
            backupSession(this.profile);
          } catch { /* không cần báo lỗi backup khi /new */ }
        }

        // Reset session
        this.profile.sessionId = randomUUID();
        saveAgent(this.profile);
        this.isNewSession = true;
        this.messageCount = 0;

        // Xoá history file của Gemini nếu dùng Gemini
        if (this.profile.cli === 'gemini') {
          clearGeminiHistory(this.profile);
        }

        await ctx.reply('🔄 Đã reset! Cuộc trò chuyện tiếp theo sẽ bắt đầu mới hoàn toàn.');
        log(name, 'Session reset bởi /new');
        return;
      }

      // Bỏ qua các lệnh khác không nhận dạng được
      if (text.startsWith('/')) return;

      // ── Xử lý tin nhắn thường ───────────────────────────────────────────

      // Kiểm tra có cần backup không trước khi xử lý
      if (shouldBackup(this.profile)) {
        log(name, 'Session sắp đầy — tự động backup và tạo session mới');
        try {
          backupSession(this.profile);
          await ctx.reply('💾 Session đã đầy, đã backup và bắt đầu session mới tự động.');
        } catch (err) {
          logError(name, `Auto backup lỗi: ${err}`);
        }
        // Tạo session mới sau backup
        this.profile.sessionId = randomUUID();
        saveAgent(this.profile);
        this.isNewSession = true;
        if (this.profile.cli === 'gemini') clearGeminiHistory(this.profile);
      }

      // Hiện trạng thái "đang gõ" trong lúc AI xử lý
      const typingInterval = setInterval(() => {
        ctx.sendChatAction('typing').catch(() => {});
      }, 4000);
      ctx.sendChatAction('typing').catch(() => {});

      log(name, `Tin nhắn #${this.messageCount + 1}: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);

      try {
        const response = await callAI(this.profile, text, this.isNewSession);

        clearInterval(typingInterval);
        this.isNewSession = false;
        this.messageCount++;

        // Gửi response — tự cắt nếu quá dài
        await this.sendLongMessage(ctx, response);

      } catch (err) {
        clearInterval(typingInterval);
        const message = err instanceof Error ? err.message : String(err);
        logError(name, `Lỗi xử lý tin nhắn: ${message}`);
        await ctx.reply(`❌ Lỗi: ${message}`);
      }
    });

    this.bot.catch((err) => {
      logError(name, `Bot error: ${err}`);
    });
  }

  // Gửi tin nhắn dài — cắt thành nhiều phần nếu vượt giới hạn Telegram
  private async sendLongMessage(ctx: any, text: string) {
    if (text.length <= TG_MAX_LENGTH) {
      // Thử gửi với Markdown, nếu lỗi thì gửi plain text
      await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() => ctx.reply(text));
      return;
    }
    // Cắt thành từng đoạn 4000 ký tự
    for (let i = 0; i < text.length; i += 4000) {
      await ctx.reply(text.substring(i, i + 4000)).catch(() => {});
    }
  }

  // ─── Start / Stop ──────────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    log(this.profile.name, `Bot khởi động — CLI: ${this.profile.cli}`);
    this.bot.launch();
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    log(this.profile.name, 'Bot dừng lại');
    this.bot.stop('SIGTERM');
  }

  isRunning() {
    return this.running;
  }

  getProfile() {
    return this.profile;
  }

  getMessageCount() {
    return this.messageCount;
  }
}
