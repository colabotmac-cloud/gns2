#!/usr/bin/env bash
set -e

echo ""
echo "🚀 GNS 2.0 — Install"
echo "=================================="
echo ""

# ── Node.js ──────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ Node.js chưa cài. Tải tại: https://nodejs.org (cần v18+)"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js v${NODE_VER} quá cũ. Cần v18 trở lên."
  exit 1
fi
echo "✅ Node.js $(node -v)"

# ── Claude CLI ────────────────────────────────────────────────────────────────
if command -v claude &>/dev/null; then
  echo "✅ Claude Code CLI"
else
  echo "❌ Claude Code CLI — chưa cài  (npm install -g @anthropic-ai/claude-code)"
fi

# ── Gemini CLI ────────────────────────────────────────────────────────────────
if command -v gemini &>/dev/null; then
  echo "✅ Gemini CLI"
else
  echo "❌ Gemini CLI — chưa cài  (npm install -g @google/gemini-cli)"
fi

# ── Kiểm tra có ít nhất 1 CLI ─────────────────────────────────────────────────
if ! command -v claude &>/dev/null && ! command -v gemini &>/dev/null; then
  echo ""
  echo "⛔ Cần ít nhất 1 CLI trước khi cài GNS 2.0. Cài xong rồi chạy lại."
  exit 1
fi

# ── npm install + build ───────────────────────────────────────────────────────
echo ""
echo "📦 Cài dependencies..."
npm install --silent

echo "🔨 Build..."
npm run build --silent

echo ""
echo "=================================="
echo "✅ Cài xong!"
echo ""

# ── Hỏi có setup ngay không ──────────────────────────────────────────────────
read -p "Chạy setup ngay? (y/n): " DO_SETUP
if [ "$DO_SETUP" = "y" ]; then
  npm run setup
else
  echo ""
  echo "Chạy thủ công:"
  echo "  npm run setup    ← cấu hình port + tạo agent"
  echo "  npm start        ← khởi động"
  echo ""
fi
