import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import type { AgentProfile } from '../lib/config.js';
import { loadGeminiHistory, appendGeminiHistory } from '../lib/session.js';

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
    // Thêm ~/.local/bin và ~/.npm-global/bin vào PATH để tìm được claude/gemini
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
// Claude nhớ context qua session file của chính nó (~/.claude/projects/...)
// isNewSession = true  → dùng --session-id (tạo mới)
// isNewSession = false → dùng --resume (tiếp tục)

export async function callClaude(
  profile: AgentProfile,
  prompt: string,
  isNewSession: boolean
): Promise<string> {
  const args = [
    '--print',
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'text',
    '--max-turns', String(profile.maxTurns ?? 5),
    isNewSession ? '--session-id' : '--resume',
    profile.sessionId,
    prompt,
  ];

  const cwd = profile.workingDir ?? os.homedir();
  return runCommand('claude', args, cwd, profile.timeoutMs ?? 180_000);
}

// ─── Gemini Adapter ───────────────────────────────────────────────────────────
// Gemini không có bộ nhớ → tự inject lịch sử vào prompt mỗi lần gọi

const GEMINI_HISTORY_TURNS = 20; // Số lượt gần nhất inject vào prompt

function buildGeminiPrompt(profile: AgentProfile, newMessage: string): string {
  const history = loadGeminiHistory(profile);

  // Lấy N turns gần nhất (1 turn = 1 user + 1 assistant)
  const recent = history.slice(-(GEMINI_HISTORY_TURNS * 2));

  if (recent.length === 0) {
    // Chưa có lịch sử → gọi thẳng
    return newMessage;
  }

  // Ghép lịch sử vào đầu prompt
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
  profile: AgentProfile,
  prompt: string
): Promise<string> {
  const fullPrompt = buildGeminiPrompt(profile, prompt);
  const cwd = profile.workingDir ?? os.homedir();

  const response = await runCommand(
    'gemini',
    ['-p', fullPrompt],
    cwd,
    profile.timeoutMs ?? 180_000
  );

  // Lưu tin nhắn mới vào lịch sử sau khi có response
  appendGeminiHistory(profile, 'user', prompt);
  appendGeminiHistory(profile, 'assistant', response);

  return response;
}

// ─── Unified call ─────────────────────────────────────────────────────────────

export async function callAI(
  profile: AgentProfile,
  prompt: string,
  isNewSession: boolean
): Promise<string> {
  if (profile.cli === 'claude') {
    return callClaude(profile, prompt, isNewSession);
  } else {
    return callGemini(profile, prompt);
  }
}
