# GNS 2.0 — Genesis Agent Manager

Kết nối Claude Code CLI / Gemini CLI với Telegram bot. Session memory cố định, backup tự động, Web UI quản lý.

## Cài đặt

```bash
git clone https://github.com/colabotmac-cloud/gns2
cd gns2
bash install.sh
```

## Yêu cầu
- Node.js v18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`) hoặc Gemini CLI (`npm install -g @google/gemini-cli`)
- Telegram Bot Token (tạo qua @BotFather)
- Telegram User ID của bạn (nhắn @userinfobot)

## Tính năng
- Telegram bot với session memory (Claude) hoặc context injection (Gemini)
- Backup tự động khi đạt 80 messages hoặc 500KB
- Web UI: Agents / Sessions / Backups / Logs
- Tạo agent mới với auto-detect CLI
- Port tự động detect nếu bận
