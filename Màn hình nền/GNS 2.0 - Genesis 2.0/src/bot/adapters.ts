import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import type { AgentInstance, WorkerInstance } from '../lib/config.js';
import { getRecentLog } from '../lib/session.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CallResult {
  text: string;
  error?: string;
}

// ─── Helper: chạy lệnh terminal, trả về stdout ───────────────────────────────

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const localBin = path.join(os.homedir(), '.local', 'bin');
    const npmBin = path.join(os.homedir(), '.npm-global', 'bin');
    const env = {
      ...process.env,
      PATH: `${localBin}:${npmBin}:${process.env.PATH ?? ''}`,
    };

    const proc = spawn(cmd, args, { cwd, env });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Timeout sau ${timeoutMs / 1000}s — AI không trả lời`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `Lệnh thoát với code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Claude Adapter ───────────────────────────────────────────────────────────

export async function callClaude(
  agent: AgentInstance,
  worker: WorkerInstance,
  prompt: string,
  isNewSession: boolean
): Promise<string> {
  const args = [
    '--print',
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'text',
    '--max-turns', '5',
    isNewSession ? '--session-id' : '--resume',
    agent.sessionId,
    prompt,
  ];

  const cwd = os.homedir();
  return runCommand('claude', args, cwd, 180_000);
}

// ─── Gemini Adapter ───────────────────────────────────────────────────────────

const GEMINI_HISTORY_TURNS = 20;

function buildGeminiPrompt(worker: WorkerInstance, newMessage: string): string {
  const recent = getRecentLog(worker, GEMINI_HISTORY_TURNS);

  if (recent.length === 0) {
    return newMessage;
  }

  const historyText = recent
    .map(m => `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`)
    .join('\n');

  return (
    `Đây là lịch sử cuộc trò chuyện trước:\n` +
    `${historyText}\n` +
    `---\n` +
    `Tin nhắn mới từ User: ${newMessage}`
  );
}

export async function callGemini(
  agent: AgentInstance,
  worker: WorkerInstance,
  prompt: string
): Promise<string> {
  const fullPrompt = buildGeminiPrompt(worker, prompt);
  const cwd = os.homedir();

  return runCommand(
    'gemini',
    ['-p', fullPrompt],
    cwd,
    180_000
  );
}

// ─── Unified call ─────────────────────────────────────────────────────────────

export async function callAI(
  agent: AgentInstance,
  worker: WorkerInstance,
  prompt: string,
  isNewSession: boolean
): Promise<string> {
  if (agent.type === 'claude-cli') {
    return callClaude(agent, worker, prompt, isNewSession);
  } else {
    return callGemini(agent, worker, prompt);
  }
}

// ─── Handoff Summary ──────────────────────────────────────────────────────────

export async function generateHandoffSummary(
  agent: AgentInstance,
  worker: WorkerInstance
): Promise<string> {
  const summaryPrompt = 'Summarize our conversation so far in 3-5 sentences for handoff to another AI agent. Be concise.';

  try {
    const result = await Promise.race([
      callAI(agent, worker, summaryPrompt, false),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Handoff timeout')), 30_000)
      ),
    ]);
    return result;
  } catch {
    return '';
  }
}
