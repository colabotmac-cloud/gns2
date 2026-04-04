import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import crypto from 'crypto';
import {
  loadGlobalConfig,
  checkAvailableClis,
  listAiAgents,
  loadAiAgent,
  saveAiAgent,
  deleteAiAgent,
  listWorkers,
  loadWorker,
  saveWorker,
  deleteWorker,
  AgentInstance,
  WorkerInstance,
} from '../lib/config.js';
import { listBackups, readBackup } from '../lib/backup.js';
import { readLog } from '../lib/logger.js';
import { manager } from '../bot/manager.js';
import { checkForUpdate, applyUpdate, restartGns } from '../lib/updater.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.static(path.join(__dirname, '..', '..', 'src', 'web', 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Chưa đăng nhập' }); return; }
  try {
    const config = loadGlobalConfig();
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: 'Thiếu username hoặc password' }); return;
  }
  try {
    const config = loadGlobalConfig();
    if (username !== config.adminUser) {
      res.status(401).json({ error: 'Sai thông tin đăng nhập' }); return;
    }
    const ok = await bcrypt.compare(password, config.adminHash);
    if (!ok) { res.status(401).json({ error: 'Sai thông tin đăng nhập' }); return; }

    const token = jwt.sign({ user: username }, config.jwtSecret, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/ai-agents ───────────────────────────────────────────────────────

app.get('/api/ai-agents', authMiddleware, (_req: Request, res: Response) => {
  try {
    res.json(listAiAgents());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/ai-agents ──────────────────────────────────────────────────────

app.post('/api/ai-agents', authMiddleware, (req: Request, res: Response) => {
  try {
    const { name, type, model } = req.body ?? {};
    if (!name || !type) {
      res.status(400).json({ error: 'Thiếu name hoặc type' }); return;
    }
    if (type !== 'claude-cli' && type !== 'gemini-cli') {
      res.status(400).json({ error: 'type phải là claude-cli hoặc gemini-cli' }); return;
    }
    const available = checkAvailableClis();
    const cliKey = type === 'claude-cli' ? 'claude' : 'gemini';
    if (!available[cliKey]) {
      res.status(400).json({ error: `CLI "${cliKey}" chưa được cài trên máy này` }); return;
    }
    // Default model nếu không chọn
    const defaultModel = type === 'claude-cli' ? 'claude-sonnet-4-5' : 'gemini-2.5-pro';
    const agent: AgentInstance = {
      id: crypto.randomUUID(),
      name,
      type,
      model: model || defaultModel,
      sessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    saveAiAgent(agent);
    res.json({ ok: true, agent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── PUT /api/ai-agents/:id ───────────────────────────────────────────────────

app.put('/api/ai-agents/:id', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = loadAiAgent(req.params.id);
    if (!agent) { res.status(404).json({ error: 'Không tìm thấy agent' }); return; }
    const { name, model } = req.body ?? {};
    if (name) agent.name = name;
    if (model) agent.model = model;
    saveAiAgent(agent);
    res.json({ ok: true, agent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── DELETE /api/ai-agents/:id ────────────────────────────────────────────────

app.delete('/api/ai-agents/:id', authMiddleware, (_req: Request, res: Response) => {
  try {
    deleteAiAgent(_req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/workers ─────────────────────────────────────────────────────────

app.get('/api/workers', authMiddleware, (_req: Request, res: Response) => {
  try {
    res.json(manager.listWorkerStatus());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/workers ────────────────────────────────────────────────────────

app.post('/api/workers', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, botToken, allowedUsers, systemPrompt, pin, agentId } = req.body ?? {};
    if (!name || !botToken || !allowedUsers || !pin || !agentId) {
      res.status(400).json({ error: 'Thiếu thông tin bắt buộc' }); return;
    }
    if (!loadAiAgent(agentId)) {
      res.status(400).json({ error: `Agent "${agentId}" không tồn tại` }); return;
    }
    const sessionPin = await bcrypt.hash(String(pin), 10);
    const worker: WorkerInstance = {
      id: crypto.randomUUID(),
      name,
      botToken,
      allowedUsers: (allowedUsers as number[]).map(Number).filter(n => !isNaN(n)),
      systemPrompt: systemPrompt ?? '',
      sessionPin,
      activeAgentId: agentId,
      conversationLog: [],
      createdAt: new Date().toISOString(),
    };
    saveWorker(worker);
    res.json({ ok: true, worker: { ...worker, sessionPin: '[hashed]', conversationLog: [] } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/workers/:id/detail ─────────────────────────────────────────────

app.get('/api/workers/:id/detail', authMiddleware, (req: Request, res: Response) => {
  try {
    const worker = loadWorker(req.params.id);
    if (!worker) { res.status(404).json({ error: 'Không tìm thấy worker' }); return; }
    res.json({
      id: worker.id,
      name: worker.name,
      allowedUsers: worker.allowedUsers,
      systemPrompt: worker.systemPrompt,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── PUT /api/workers/:id ─────────────────────────────────────────────────────

app.put('/api/workers/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const worker = loadWorker(req.params.id);
    if (!worker) { res.status(404).json({ error: 'Không tìm thấy worker' }); return; }
    const { name, botToken, allowedUsers, systemPrompt, pin } = req.body ?? {};
    if (name) worker.name = name;
    if (botToken) worker.botToken = botToken;
    if (allowedUsers) worker.allowedUsers = (allowedUsers as number[]).map(Number).filter(n => !isNaN(n));
    if (systemPrompt !== undefined) worker.systemPrompt = systemPrompt;
    if (pin && String(pin).length >= 4) worker.sessionPin = await bcrypt.hash(String(pin), 10);
    saveWorker(worker);
    // Luôn restart để áp dụng thay đổi (token mới, v.v.)
    await manager.stopWorker(req.params.id);
    manager.startWorker(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── DELETE /api/workers/:id ──────────────────────────────────────────────────

app.delete('/api/workers/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    await manager.stopWorker(req.params.id);
    deleteWorker(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/workers/:id/start ─────────────────────────────────────────────

app.post('/api/workers/:id/start', authMiddleware, (req: Request, res: Response) => {
  try {
    manager.startWorker(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ─── POST /api/workers/:id/stop ──────────────────────────────────────────────

app.post('/api/workers/:id/stop', authMiddleware, async (req: Request, res: Response) => {
  try {
    await manager.stopWorker(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ─── POST /api/workers/:id/swap ──────────────────────────────────────────────

app.post('/api/workers/:id/swap', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.body ?? {};
    if (!agentId) { res.status(400).json({ error: 'Thiếu agentId' }); return; }
    await manager.swapAgent(req.params.id, agentId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/system/clis ─────────────────────────────────────────────────────

app.get('/api/system/clis', authMiddleware, (_req: Request, res: Response) => {
  try {
    res.json(checkAvailableClis());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/backups ─────────────────────────────────────────────────────────

app.get('/api/backups', authMiddleware, (_req: Request, res: Response) => {
  try {
    res.json(listBackups());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/backups/:filename ───────────────────────────────────────────────

app.get('/api/backups/:filename', authMiddleware, (req: Request, res: Response) => {
  try {
    const content = readBackup(req.params.filename);
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

// ─── GET /api/logs/:name ──────────────────────────────────────────────────────

app.get('/api/logs/:name', authMiddleware, (req: Request, res: Response) => {
  try {
    const lines = readLog(req.params.name, 50);
    res.json({ lines });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/update/check ────────────────────────────────────────────────────

app.get('/api/update/check', authMiddleware, (_req: Request, res: Response) => {
  try {
    const info = checkForUpdate();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/update/apply ───────────────────────────────────────────────────

app.post('/api/update/apply', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const result = await applyUpdate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, log: [], error: String(err) });
  }
});

// ─── POST /api/update/restart ─────────────────────────────────────────────────

app.post('/api/update/restart', authMiddleware, (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Đang restart...' });
  restartGns();
});

// ─── Start server ─────────────────────────────────────────────────────────────

export function startWebServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const config = loadGlobalConfig();

    function tryListen(port: number) {
      const server = app.listen(port, () => {
        console.log(`[web] Server chạy tại http://localhost:${port}`);
        resolve(port);
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[web] Port ${port} bận, thử ${port + 1}...`);
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
    }

    tryListen(config.port);
  });
}
