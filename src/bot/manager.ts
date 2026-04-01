import { listWorkers, loadWorker, saveWorker, loadAiAgent } from '../lib/config.js';
import { getLogStats } from '../lib/session.js';
import { log, logError } from '../lib/logger.js';
import { TelegramBotService } from './telegram-bot.js';
import { generateHandoffSummary } from './adapters.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkerStatus {
  id: string;
  name: string;
  running: boolean;
  activeAgentId: string;
  agentName: string;
  agentType: string;
  messageCount: number;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

class BotManager {
  private bots: Map<string, TelegramBotService> = new Map(); // workerId → bot

  startWorker(workerId: string): void {
    if (this.bots.has(workerId)) {
      log('manager', `Worker "${workerId}" đã đang chạy`);
      return;
    }

    const worker = loadWorker(workerId);
    if (!worker) {
      throw new Error(`Không tìm thấy worker "${workerId}"`);
    }

    const agent = loadAiAgent(worker.activeAgentId);
    if (!agent) {
      throw new Error(`Không tìm thấy agent "${worker.activeAgentId}" cho worker "${worker.name}"`);
    }

    const bot = new TelegramBotService(worker, agent);
    bot.start();
    this.bots.set(workerId, bot);
    log('manager', `Đã khởi động worker "${worker.name}" với agent "${agent.name}"`);
  }

  async stopWorker(workerId: string): Promise<void> {
    const bot = this.bots.get(workerId);
    if (!bot) {
      log('manager', `Worker "${workerId}" không đang chạy`);
      return;
    }
    await bot.stop();
    this.bots.delete(workerId);
    log('manager', `Đã dừng worker "${workerId}"`);
  }

  startAll(): void {
    const workers = listWorkers();
    if (workers.length === 0) {
      log('manager', 'Chưa có worker nào. Chạy setup để tạo worker.');
      return;
    }
    for (const worker of workers) {
      try {
        this.startWorker(worker.id);
      } catch (err) {
        logError('manager', `Không khởi động được "${worker.name}": ${err}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.bots.keys());
    await Promise.all(ids.map(id => this.stopWorker(id)));
    log('manager', 'Đã dừng tất cả workers');
  }

  async swapAgent(workerId: string, newAgentId: string): Promise<void> {
    const worker = loadWorker(workerId);
    if (!worker) throw new Error(`Không tìm thấy worker "${workerId}"`);

    const currentAgent = loadAiAgent(worker.activeAgentId);
    const newAgent = loadAiAgent(newAgentId);
    if (!newAgent) throw new Error(`Không tìm thấy agent "${newAgentId}"`);

    // Generate handoff summary
    let summary = '';
    if (currentAgent) {
      try {
        summary = await Promise.race([
          generateHandoffSummary(currentAgent, worker),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 30_000)
          ),
        ]);
      } catch {
        summary = '';
      }
    }

    worker.handoffContext = summary;
    worker.activeAgentId = newAgentId;
    saveWorker(worker);

    // Restart bot with new agent
    await this.stopWorker(workerId);
    this.startWorker(workerId);

    log('manager', `Worker "${worker.name}" đã swap sang agent "${newAgent.name}"`);
  }

  listWorkerStatus(): WorkerStatus[] {
    const workers = listWorkers();
    return workers.map(worker => {
      const bot = this.bots.get(worker.id);
      const agent = loadAiAgent(worker.activeAgentId);
      return {
        id: worker.id,
        name: worker.name,
        running: bot?.isRunning() ?? false,
        activeAgentId: worker.activeAgentId,
        agentName: agent?.name ?? 'Unknown',
        agentType: agent?.type ?? 'unknown',
        messageCount: bot?.getMessageCount() ?? getLogStats(worker).messageCount,
      };
    });
  }

  isWorkerRunning(workerId: string): boolean {
    return this.bots.has(workerId) && (this.bots.get(workerId)?.isRunning() ?? false);
  }

  getWorkerStatus(workerId: string): WorkerStatus | null {
    const worker = loadWorker(workerId);
    if (!worker) return null;

    const bot = this.bots.get(workerId);
    const agent = loadAiAgent(worker.activeAgentId);
    return {
      id: worker.id,
      name: worker.name,
      running: bot?.isRunning() ?? false,
      activeAgentId: worker.activeAgentId,
      agentName: agent?.name ?? 'Unknown',
      agentType: agent?.type ?? 'unknown',
      messageCount: bot?.getMessageCount() ?? getLogStats(worker).messageCount,
    };
  }
}

// Export singleton
export const manager = new BotManager();
