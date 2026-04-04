import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Paths ────────────────────────────────────────────────────────────────────

// Thư mục gốc của GNS (nơi chứa package.json)
export function getGnsRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

// Kiểm tra dir có nằm trong 1 git repo không (kể cả parent dirs)
function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Git root thực sự (có thể là parent của GNS nếu clone vào subdir)
function getGitRoot(dir: string): string {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: dir }).toString().trim();
  } catch {
    return dir;
  }
}

// ─── Update Check ─────────────────────────────────────────────────────────────

export interface UpdateInfo {
  hasUpdate: boolean;
  currentCommit: string;
  latestCommit: string;
  currentVersion: string;
  error?: string;
}

export function checkForUpdate(): UpdateInfo {
  const root = getGnsRoot();
  const pkgPath = path.join(root, 'package.json');
  const currentVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? '0.0.0';

  if (!isGitRepo(root)) {
    return {
      hasUpdate: false,
      currentCommit: 'N/A',
      latestCommit: 'N/A',
      currentVersion,
      error: 'GNS không được cài từ git — không thể kiểm tra cập nhật',
    };
  }

  const gitRoot = getGitRoot(root);

  try {
    // Lấy commit hiện tại
    const currentCommit = execSync('git rev-parse --short HEAD', { cwd: gitRoot }).toString().trim();

    // Fetch origin (không merge)
    execSync('git fetch origin master --quiet', { cwd: gitRoot, timeout: 15_000 });

    // Lấy commit mới nhất trên origin
    const latestCommit = execSync('git rev-parse --short origin/master', { cwd: gitRoot }).toString().trim();

    return {
      hasUpdate: currentCommit !== latestCommit,
      currentCommit,
      latestCommit,
      currentVersion,
    };
  } catch (err) {
    return {
      hasUpdate: false,
      currentCommit: 'N/A',
      latestCommit: 'N/A',
      currentVersion,
      error: `Không thể kiểm tra: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Apply Update ─────────────────────────────────────────────────────────────

export interface UpdateResult {
  ok: boolean;
  log: string[];
  error?: string;
}

export async function applyUpdate(): Promise<UpdateResult> {
  const root = getGnsRoot();
  const log: string[] = [];

  if (!isGitRepo(root)) {
    return { ok: false, log, error: 'GNS không được cài từ git' };
  }

  const gitRoot = getGitRoot(root);

  try {
    log.push('📥 git pull origin master...');
    const pullOut = execSync('git pull origin master', { cwd: gitRoot, timeout: 30_000 }).toString();
    log.push(pullOut.trim());

    log.push('📦 npm install...');
    execSync('npm install --silent', { cwd: root, timeout: 120_000 });
    log.push('✅ npm install xong');

    log.push('🔨 npm run build...');
    execSync('npm run build', { cwd: root, timeout: 60_000 });
    log.push('✅ Build xong');

    log.push('✅ Cập nhật hoàn tất — cần restart để áp dụng');
    return { ok: true, log };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`❌ Lỗi: ${msg}`);
    return { ok: false, log, error: msg };
  }
}

// ─── Restart GNS ─────────────────────────────────────────────────────────────

export function restartGns(): void {
  const root = getGnsRoot();

  // Spawn script restart tách biệt, chờ 2s rồi start lại
  const script = `sleep 2 && cd "${root}" && node dist/index.js &`;
  spawn('bash', ['-c', script], {
    detached: true,
    stdio: 'ignore',
    cwd: root,
  }).unref();

  // Thoát process hiện tại — process mới sẽ start sau 2s
  setTimeout(() => process.exit(0), 500);
}
