import { listAgents, loadAgent } from '../lib/config.js';
import { getSessionStats } from '../lib/session.js';
import { log, logError } from '../lib/logger.js';
import { TelegramBotService } from './telegram-bot.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentStatus {
  name: string;
  cli: 'claude' | 'gemini';
  running: boolean;
  messageCount: number;
  sessionId: string;
  sessionStats: { messageCount: number; fileSizeBytes: number };
}

// ─── Manager ─────────────────────────────────────────────────────────────────

class BotManager {
  // Map tên agent → instance bot đang chạy
  private bots: Map<string, TelegramBotService> = new Map();

  // Khởi động 1 agent theo tên
  startAgent(name: string): void {
    if (this.bots.has(name)) {
      log('manager', `Agent "${name}" đã đang chạy`);
      return;
    }

    const profile = loadAgent(name);
    if (!profile) {
      throw new Error(`Không tìm thấy agent "${name}"`);
    }

    const bot = new TelegramBotService(profile);
    bot.start();
    this.bots.set(name, bot);
    log('manager', `Đã khởi động agent "${name}" (${profile.cli})`);
  }

  // Dừng 1 agent theo tên
  async stopAgent(name: string): Promise<void> {
    const bot = this.bots.get(name);
    if (!bot) {
      log('manager', `Agent "${name}" không đang chạy`);
      return;
    }
    await bot.stop();
    this.bots.delete(name);
    log('manager', `Đã dừng agent "${name}"`);
  }

  // Khởi động tất cả agents có trong config
  startAll(): void {
    const agents = listAgents();
    if (agents.length === 0) {
      log('manager', 'Chưa có agent nào. Chạy setup để tạo agent.');
      return;
    }
    for (const profile of agents) {
      try {
        this.startAgent(profile.name);
      } catch (err) {
        logError('manager', `Không khởi động được "${profile.name}": ${err}`);
      }
    }
  }

  // Dừng tất cả agents
  async stopAll(): Promise<void> {
    const names = Array.from(this.bots.keys());
    await Promise.all(names.map(name => this.stopAgent(name)));
    log('manager', 'Đã dừng tất cả agents');
  }

  // Lấy trạng thái 1 agent (cho web UI)
  getStatus(name: string): AgentStatus | null {
    const profile = loadAgent(name);
    if (!profile) return null;

    const bot = this.bots.get(name);
    return {
      name: profile.name,
      cli: profile.cli,
      running: bot?.isRunning() ?? false,
      messageCount: bot?.getMessageCount() ?? 0,
      sessionId: profile.sessionId,
      sessionStats: getSessionStats(profile),
    };
  }

  // Lấy trạng thái tất cả agents (cho web UI)
  listStatus(): AgentStatus[] {
    const agents = listAgents();
    return agents.map(profile => {
      const bot = this.bots.get(profile.name);
      return {
        name: profile.name,
        cli: profile.cli,
        running: bot?.isRunning() ?? false,
        messageCount: bot?.getMessageCount() ?? 0,
        sessionId: profile.sessionId,
        sessionStats: getSessionStats(profile),
      };
    });
  }
}

// Export singleton — toàn bộ app dùng chung 1 instance
export const manager = new BotManager();
