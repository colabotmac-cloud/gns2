import { Telegraf } from 'telegraf';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { saveWorker, saveAiAgent } from '../lib/config.js';
import { claudeSessionExists, appendToLog, clearLog, getLogStats } from '../lib/session.js';
import { shouldBackup, backupSession } from '../lib/backup.js';
import { log, logError } from '../lib/logger.js';
import { callAI } from './adapters.js';
import type { AgentInstance, WorkerInstance } from '../lib/config.js';

// Telegram giới hạn 1 tin nhắn tối đa 4096 ký tự
const TG_MAX_LENGTH = 4096;

export class TelegramBotService {
  private bot: Telegraf;
  private worker: WorkerInstance;
  private agent: AgentInstance;
  private isNewSession: boolean = false;
  private running: boolean = false;
  private awaitingPin: boolean = false;
  // Queue để serialize tin nhắn — tránh concurrent callAI cùng sessionId
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(worker: WorkerInstance, agent: AgentInstance) {
    this.worker = worker;
    this.agent = agent;
    this.bot = new Telegraf(worker.botToken);

    // Xác định session mới hay resume cho Claude
    if (agent.type === 'claude-cli') {
      this.isNewSession = !claudeSessionExists(agent);
      log(worker.name, `Claude session ${agent.sessionId} — ${this.isNewSession ? 'MỚI' : 'RESUME'}`);
    } else {
      this.isNewSession = false;
      const stats = getLogStats(worker);
      log(worker.name, `Gemini — ${stats.messageCount} tin nhắn trong conversationLog`);
    }

    this.registerHandlers();
  }

  // ─── Đăng ký các handler xử lý tin nhắn ───────────────────────────────────

  private registerHandlers() {
    const { allowedUsers, name } = this.worker;

    this.bot.on('message', async (ctx) => {
      const userId = ctx.from?.id;

      if (!userId || !allowedUsers.includes(userId)) return;

      const msg = ctx.message;
      if (!('text' in msg)) return;
      const text = msg.text.trim();

      // ── PIN flow ─────────────────────────────────────────────────────────
      if (this.awaitingPin) {
        this.awaitingPin = false;
        const correct = await bcrypt.compare(text, this.worker.sessionPin);
        if (!correct) {
          await ctx.reply('PIN không đúng. Thử lại với /clearhistory');
          return;
        }

        // Backup trước khi xoá
        const stats = getLogStats(this.worker);
        if (stats.messageCount > 0) {
          try { backupSession(this.worker, this.agent); } catch { /* ignore */ }
        }

        // Clear log
        clearLog(this.worker);

        // Nếu là Claude: tạo sessionId mới
        if (this.agent.type === 'claude-cli') {
          this.agent.sessionId = randomUUID();
          saveAiAgent(this.agent);
          this.isNewSession = true;
        }

        saveWorker(this.worker);
        await ctx.reply('Đã xoá lịch sử. Cuộc trò chuyện tiếp theo bắt đầu mới hoàn toàn.');
        log(name, 'Lịch sử đã được xoá bởi /clearhistory');
        return;
      }

      // ── Xử lý các lệnh ──────────────────────────────────────────────────

      if (text === '/help') {
        await ctx.reply(
          'Danh sách lệnh:\n' +
          '/clearhistory — Xoá lịch sử (cần xác nhận PIN)\n' +
          '/status — Xem trạng thái hiện tại\n' +
          '/backup — Backup lịch sử ngay lập tức\n' +
          '/help — Danh sách lệnh này'
        );
        return;
      }

      if (text === '/status') {
        const stats = getLogStats(this.worker);
        await ctx.reply(
          `Trạng thái:\n` +
          `Worker: ${name}\n` +
          `Agent: ${this.agent.name} (${this.agent.type})\n` +
          `Session ID: ${this.agent.sessionId.substring(0, 8)}...\n` +
          `Tin nhắn: ${stats.messageCount}\n` +
          `Kích thước log: ${(stats.fileSizeBytes / 1024).toFixed(1)} KB`
        );
        return;
      }

      if (text === '/backup') {
        await ctx.reply('Đang backup...');
        try {
          const filePath = backupSession(this.worker, this.agent);
          if (filePath) {
            await ctx.reply(`Backup xong!\nFile: ${filePath.split('/').pop()}`);
          } else {
            await ctx.reply('Chưa có tin nhắn nào để backup.');
          }
        } catch (err) {
          await ctx.reply(`Backup lỗi: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      if (text === '/clearhistory') {
        this.awaitingPin = true;
        await ctx.reply('Nhập PIN để xác nhận xoá lịch sử:');
        return;
      }

      // Bỏ qua các lệnh khác không nhận dạng được
      if (text.startsWith('/')) return;

      // ── Queue tin nhắn — xử lý tuần tự để tránh race condition ─────────
      this.messageQueue = this.messageQueue.then(() =>
        this.handleUserMessage(ctx, text)
      );
    });

    this.bot.catch((err) => {
      logError(name, `Bot error: ${err}`);
    });
  }

  // ─── Xử lý tin nhắn thường (được gọi qua queue) ────────────────────────────

  private async handleUserMessage(ctx: any, text: string): Promise<void> {
    const { name } = this.worker;

    // ── Kiểm tra backup tự động ────────────────────────────────────────────
    if (shouldBackup(this.worker)) {
      log(name, 'ConversationLog sắp đầy — tự động backup và tạo session mới');
      try {
        backupSession(this.worker, this.agent);
        await ctx.reply('Session đã đầy, đã backup và bắt đầu session mới tự động.');
      } catch (err) {
        logError(name, `Auto backup lỗi: ${err}`);
      }
      clearLog(this.worker);
      if (this.agent.type === 'claude-cli') {
        this.agent.sessionId = randomUUID();
        saveAiAgent(this.agent);
        this.isNewSession = true;
      }
      saveWorker(this.worker);
    }

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 4000);
    ctx.sendChatAction('typing').catch(() => {});

    const msgCount = getLogStats(this.worker).messageCount;
    log(name, `Tin nhắn #${msgCount + 1}: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);

    // Append user message trước khi gọi AI
    appendToLog(this.worker, 'user', text, this.agent.id);

    try {
      const response = await callAI(this.agent, this.worker, text, this.isNewSession);

      clearInterval(typingInterval);
      this.isNewSession = false;

      // Append assistant response
      appendToLog(this.worker, 'assistant', response, this.agent.id);
      saveWorker(this.worker);

      await this.sendLongMessage(ctx, response);

    } catch (err) {
      clearInterval(typingInterval);
      // Remove the user message we appended if AI failed
      this.worker.conversationLog.pop();
      const message = err instanceof Error ? err.message : String(err);
      logError(name, `Lỗi xử lý tin nhắn: ${message}`);
      await ctx.reply(`Lỗi: ${message}`);
    }
  }

  // Gửi tin nhắn dài — cắt thành nhiều phần nếu vượt giới hạn Telegram
  private async sendLongMessage(ctx: any, text: string) {
    if (text.length <= TG_MAX_LENGTH) {
      await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() => ctx.reply(text));
      return;
    }
    for (let i = 0; i < text.length; i += 4000) {
      await ctx.reply(text.substring(i, i + 4000)).catch(() => {});
    }
  }

  // ─── Start / Stop ──────────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    log(this.worker.name, `Bot khởi động — Agent: ${this.agent.name} (${this.agent.type})`);
    this.bot.launch().catch((err: Error) => {
      this.running = false;
      logError(this.worker.name, `Lỗi khởi động bot (token sai?): ${err.message}`);
    });
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    log(this.worker.name, 'Bot dừng lại');
    this.bot.stop('SIGTERM');
  }

  isRunning() {
    return this.running;
  }

  getWorker() {
    return this.worker;
  }

  getAgent() {
    return this.agent;
  }

  getMessageCount() {
    return getLogStats(this.worker).messageCount;
  }
}
