import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import crypto from 'crypto';
import { loadGlobalConfig, checkAvailableClis, saveAgent, loadAgent, AgentProfile } from '../lib/config.js';
import { listBackups, readBackup } from '../lib/backup.js';
import { readLog } from '../lib/logger.js';
import { manager } from '../bot/manager.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Serve HTML tĩnh từ src/web/public/
app.use(express.static(path.join(__dirname, 'public')));

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

// ─── GET /api/agents ──────────────────────────────────────────────────────────
// Danh sách tất cả agents + trạng thái running/stopped

app.get('/api/agents', authMiddleware, (_req: Request, res: Response) => {
  try {
    res.json(manager.listStatus());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/agents/start/:name ─────────────────────────────────────────────

app.post('/api/agents/start/:name', authMiddleware, (req: Request, res: Response) => {
  try {
    manager.startAgent(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ─── POST /api/agents/stop/:name ──────────────────────────────────────────────

app.post('/api/agents/stop/:name', authMiddleware, async (req: Request, res: Response) => {
  try {
    await manager.stopAgent(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ─── GET /api/system/clis ─────────────────────────────────────────────────────
// Quét hệ thống xem có claude / gemini CLI không

app.get('/api/system/clis', authMiddleware, (_req: Request, res: Response) => {
  try {
    res.json(checkAvailableClis());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/agents ─────────────────────────────────────────────────────────
// Tạo agent mới

app.post('/api/agents', authMiddleware, (req: Request, res: Response) => {
  try {
    const { name, cli, botToken, allowedUsers } = req.body ?? {};
    if (!name || !cli || !botToken || !allowedUsers) {
      res.status(400).json({ error: 'Thiếu thông tin bắt buộc' }); return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({ error: 'Tên chỉ dùng a-z, 0-9, _, -' }); return;
    }
    if (loadAgent(name)) {
      res.status(400).json({ error: `Agent "${name}" đã tồn tại` }); return;
    }
    const available = checkAvailableClis();
    if (!available[cli as 'claude' | 'gemini']) {
      res.status(400).json({ error: `CLI "${cli}" chưa được cài trên máy này` }); return;
    }
    const profile: AgentProfile = {
      name, cli, botToken,
      allowedUsers: (allowedUsers as number[]).map(Number).filter(n => !isNaN(n)),
      sessionId: crypto.randomUUID(),
    };
    saveAgent(profile);
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── DELETE /api/agents/:name ─────────────────────────────────────────────────

app.delete('/api/agents/:name', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    await manager.stopAgent(name);
    const { deleteAgent } = await import('../lib/config.js');
    deleteAgent(name);
    res.json({ ok: true });
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
