import {
  Client, GatewayIntentBits, Partials,
  Message, TextChannel, ThreadChannel,
  DMChannel, ChannelType,
} from 'discord.js';
import { randomUUID } from 'crypto';
import { saveWorker, saveAiAgent } from '../lib/config.js';
import { claudeSessionExists, appendToLog, clearLog, getLogStats } from '../lib/session.js';
import { shouldBackup, backupSession } from '../lib/backup.js';
import { log, logError } from '../lib/logger.js';
import { callAI } from './adapters.js';
import type { AgentInstance, WorkerInstance } from '../lib/config.js';

// Discord giới hạn 2000 ký tự / tin nhắn
const DC_MAX_LENGTH = 2000;

// Sliding window — bot chỉ đọc N tin gần nhất để tiết kiệm token
const CONTEXT_WINDOW = 20;

export class DiscordBotService {
  private client: Client;
  private worker: WorkerInstance;
  private agent: AgentInstance;
  private isNewSession: boolean = false;
  private running: boolean = false;
  // Queue serialize tin nhắn — tránh race condition
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(worker: WorkerInstance, agent: AgentInstance) {
    this.worker = worker;
    this.agent = agent;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    // Session state
    if (agent.type === 'claude-cli') {
      this.isNewSession = !claudeSessionExists(agent);
      log(worker.name, `[Discord] Claude session ${agent.sessionId} — ${this.isNewSession ? 'MỚI' : 'RESUME'}`);
    } else {
      this.isNewSession = false;
      const stats = getLogStats(worker);
      log(worker.name, `[Discord] Gemini — ${stats.messageCount} tin nhắn`);
    }

    this.registerHandlers();
  }

  // ─── Register handlers ──────────────────────────────────────────────────────

  private registerHandlers() {
    const { name } = this.worker;

    this.client.on('ready', () => {
      log(name, `[Discord] Đã kết nối — @${this.client.user?.username}`);
    });

    this.client.on('messageCreate', async (message: Message) => {
      // Bỏ qua tin nhắn từ bot khác
      if (message.author.bot) return;

      const channelIds = this.worker.discordChannelIds ?? [];
      const inChannel = channelIds.includes(message.channelId);
      const botMentioned = this.client.user
        ? message.mentions.has(this.client.user.id)
        : false;

      // Chỉ xử lý nếu trong channel được cấu hình HOẶC được @mention
      if (!inChannel && !botMentioned) return;

      // Kiểm tra allowedUsers (nếu có)
      const allowedUsers = this.worker.allowedUsers;
      if (allowedUsers.length > 0 && !allowedUsers.includes(Number(message.author.id))) return;

      // Lấy nội dung, bỏ @mention prefix
      let text = message.content.trim();
      if (this.client.user) {
        text = text.replace(`<@${this.client.user.id}>`, '').trim();
        text = text.replace(`<@!${this.client.user.id}>`, '').trim();
      }
      if (!text) return;

      // ── Commands ──────────────────────────────────────────────────────────
      if (text === '!help') {
        await message.reply(
          '**Danh sách lệnh:**\n' +
          '`!status` — Xem trạng thái\n' +
          '`!backup` — Backup lịch sử\n' +
          '`!help` — Danh sách này\n\n' +
          '_Hoặc @mention để trò chuyện_'
        );
        return;
      }

      if (text === '!status') {
        const stats = getLogStats(this.worker);
        await message.reply(
          `**Trạng thái:**\n` +
          `Worker: ${name}\n` +
          `Agent: ${this.agent.name} (${this.agent.type})\n` +
          `Session: ${this.agent.sessionId.substring(0, 8)}...\n` +
          `Tin nhắn: ${stats.messageCount}`
        );
        return;
      }

      if (text === '!backup') {
        await message.reply('Đang backup...');
        try {
          const filePath = backupSession(this.worker, this.agent);
          await message.reply(filePath
            ? `✅ Backup xong! File: \`${filePath.split('/').pop()}\``
            : 'Chưa có tin nhắn nào để backup.'
          );
        } catch (err) {
          await message.reply(`❌ Backup lỗi: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      if (text.startsWith('!')) return;

      // ── Queue tin nhắn ────────────────────────────────────────────────────
      this.messageQueue = this.messageQueue.then(() =>
        this.handleUserMessage(message, text)
      );
    });

    this.client.on('error', (err) => {
      logError(name, `[Discord] Client error: ${err.message}`);
    });
  }

  // ─── Xử lý tin nhắn thường ─────────────────────────────────────────────────

  private async handleUserMessage(message: Message, text: string): Promise<void> {
    const { name } = this.worker;

    // Typing indicator
    try {
      if (
        message.channel instanceof TextChannel ||
        message.channel instanceof ThreadChannel ||
        message.channel instanceof DMChannel
      ) {
        await message.channel.sendTyping();
      }
    } catch { /* ignore */ }

    // Auto backup nếu cần
    if (shouldBackup(this.worker)) {
      log(name, '[Discord] ConversationLog sắp đầy — auto backup');
      try {
        backupSession(this.worker, this.agent);
        await message.reply('Session đã đầy, đã backup tự động và bắt đầu session mới.');
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

    const msgCount = getLogStats(this.worker).messageCount;
    log(name, `[Discord] Tin nhắn #${msgCount + 1}: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);

    appendToLog(this.worker, 'user', text, this.agent.id);

    try {
      const response = await callAI(this.agent, this.worker, text, this.isNewSession);

      this.isNewSession = false;
      appendToLog(this.worker, 'assistant', response, this.agent.id);
      saveWorker(this.worker);

      await this.sendLongMessage(message, response);

    } catch (err) {
      this.worker.conversationLog.pop();
      const msg = err instanceof Error ? err.message : String(err);
      logError(name, `[Discord] Lỗi xử lý: ${msg}`);
      await message.reply(`❌ Lỗi: ${msg}`).catch(() => {});
    }
  }

  // ─── Gửi tin nhắn dài ──────────────────────────────────────────────────────

  private async sendLongMessage(message: Message, text: string): Promise<void> {
    if (text.length <= DC_MAX_LENGTH) {
      await message.reply(text).catch(() => {});
      return;
    }
    // Cắt từng đoạn 1900 ký tự để có buffer cho Discord overhead
    for (let i = 0; i < text.length; i += 1900) {
      const chunk = text.substring(i, i + 1900);
      if (i === 0) {
        await message.reply(chunk).catch(() => {});
      } else if ('send' in message.channel) {
        await (message.channel as TextChannel).send(chunk).catch(() => {});
      }
    }
  }

  // ─── Start / Stop ───────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    log(this.worker.name, `[Discord] Bot khởi động — Agent: ${this.agent.name}`);
    this.client.login(this.worker.botToken).catch((err: Error) => {
      this.running = false;
      logError(this.worker.name, `[Discord] Lỗi login (token sai?): ${err.message}`);
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    log(this.worker.name, '[Discord] Bot dừng lại');
    this.client.destroy();
  }

  isRunning(): boolean {
    return this.running;
  }

  getWorker(): WorkerInstance {
    return this.worker;
  }

  getAgent(): AgentInstance {
    return this.agent;
  }

  getMessageCount(): number {
    return getLogStats(this.worker).messageCount;
  }
}
