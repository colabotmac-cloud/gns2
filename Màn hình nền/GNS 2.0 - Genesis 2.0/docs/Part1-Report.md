# Báo cáo Phần 1 — GNS 2.0
> Hoàn thành: 2026-04-01

---

## Kết quả

Phần 1 đã xây dựng xong toàn bộ nền móng của GNS 2.0:
- Telegram bot kết nối Claude Code CLI và Gemini CLI
- Session memory cố định cho mỗi agent
- Backup tự động khi đạt ngưỡng
- Web UI quản lý agents/sessions/backups/logs
- Install script 1 lần là xong hết

---

## Những gì đã làm

### Lớp nền (`src/lib/`)
| File | Chức năng |
|---|---|
| `config.ts` | Load/save GlobalConfig + AgentProfile, detect CLI |
| `session.ts` | Quản lý Claude session path + Gemini history |
| `backup.ts` | shouldBackup (80 msgs / 500KB) + tạo file .md |
| `logger.ts` | Log có timestamp giờ VN |

### Bot (`src/bot/`)
| File | Chức năng |
|---|---|
| `adapters.ts` | callClaude (`--resume`) + callGemini (context injection 20 turns) |
| `telegram-bot.ts` | TelegramBotService: nhận tin, kiểm tra quyền, auto backup, /new /status /backup /help |
| `manager.ts` | BotManager singleton: start/stop từng bot |

### Web (`src/web/`)
| File | Chức năng |
|---|---|
| `server.ts` | Express API: auth, agents CRUD, system/clis, backups, logs |
| `public/index.html` | Light theme, sidebar, 4 pages: Agents/Sessions/Backups/Logs |

### Entry + Setup
| File | Chức năng |
|---|---|
| `src/index.ts` | Boot: kill instance cũ (PID file) → load config → web server → start agents → graceful shutdown |
| `src/setup.ts` | Wizard: detect CLI → auto-detect port trống → admin account → tạo agent |
| `install.sh` | Check Node + CLI (báo có/không) + npm install + build + offer setup |

---

## Cách hoạt động

```
User nhắn Telegram
      ↓
TelegramBotService (kiểm tra allowedUsers)
      ↓
callAI(profile, prompt)
      ↓
  Claude: claude --resume SESSION_ID
  Gemini: gemini -p "[20 turns history]\n\nUser: ..."
      ↓
Trả lời về Telegram
      ↓
shouldBackup? → backupSession() → tạo file .md
```

---

## Cách cài (self-hosted)

```bash
git clone <repo>
cd "GNS 2.0 - Genesis 2.0"
bash install.sh
# → hỏi cài CLI không
# → npm install + build
# → hỏi setup ngay không
# → điền port, password, bot token, user ID
npm start
# Mở http://localhost:8823
```

---

## Điều kiện tiên quyết
- Node.js v18+
- Claude Code CLI hoặc Gemini CLI — install.sh sẽ hỏi cài nếu thiếu
- Telegram Bot Token (tạo qua @BotFather)
- Telegram User ID (nhắn @userinfobot để lấy)

---

## Đã test
- ✅ Build TypeScript không lỗi
- ✅ Login Web UI (admin / cola8823)
- ✅ Tạo agent qua Web UI với auto-detect CLI
- ✅ Telegram bot nhận tin + Claude trả lời + nhớ session
- ✅ Port auto-detect nếu 8823 bị bận
- ✅ Restart không cần kill thủ công — PID file tự xử lý
- ✅ Không còn lỗi 409 Conflict hay EADDRINUSE

---

## Ghi chú kỹ thuật
- **Claude session**: `~/.claude/projects/{hash}/{sessionId}.jsonl` — resume bằng `--resume`
- **Gemini**: stateless → inject 20 turns gần nhất vào đầu mỗi prompt
- **Backup dir**: `GNS 2.0 - Genesis 2.0/session-backup/`
- **Config dir**: `~/.config/gns2/`
- **Log dir**: `~/.config/gns2/logs/`
- **PID file**: `~/.config/gns2/gns2.pid` — tự kill instance cũ khi start mới
- **Port mặc định**: 8823 (tự detect port trống nếu bận, cả lúc start server)
- **GitHub**: https://github.com/colabotmac-cloud/gns2
