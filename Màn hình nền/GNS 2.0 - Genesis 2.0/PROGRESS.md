# GNS 2.0 — Genesis 2.0
> Bắt đầu: 2026-03-31 | Mục tiêu: Đơn giản, rõ ràng, từng bước

---

## TỔNG QUAN

GNS 2.0 là bản làm lại từ đầu, tập trung vào:
- Gemini CLI + Claude Code CLI kết nối Telegram bot
- Mỗi agent instance có session memory cố định + backup tự động
- Web UI quản lý agents/sessions

---

## CẤU TRÚC THƯC MỤC

```
GNS 2.0 - Genesis 2.0/
├── PROGRESS.md              ← file này (theo dõi tiến độ)
├── src/
│   ├── bot/                 ← Telegram bot + CLI adapters
│   ├── web/                 ← Web UI (Express + HTML)
│   └── lib/                 ← Shared utilities (session, backup, config)
├── config/                  ← Config templates/examples
├── session-backup/          ← Backup session files (local)
└── docs/                    ← Tài liệu nghiên cứu từng phần
```

---

## PHẦN 1: Telegram Core + Session Memory
**Trạng thái: 🔄 Đang làm (P1.6)**
**Bắt đầu: 2026-03-31**

### Mục tiêu
1. [ ] Chốt cách Gemini CLI kết nối Telegram bot
2. [ ] Chốt cách Claude Code CLI kết nối Telegram bot
3. [ ] Session cố định cho mỗi agent instance (persistent memory)
4. [ ] Backup tự động trước khi compact context:
   - Thư mục: `session-backup/`
   - Tên file: `{AgentName}_{InstanceName}_{SessionName}_{YYYY-MM-DD_HH-mm}.md`
5. [ ] Web UI quản lý agents + sessions
6. [ ] Báo cáo nghiên cứu Phần 1 → `docs/Part1-Report.md`

### Tiến độ chi tiết

#### P1.1 + P1.2: Nghiên cứu CLI → Telegram ✅ DONE (2026-03-31)
Xem chi tiết: `docs/Part1-Research.md`

**Kết quả chốt:**
- **Claude Code**: `claude --resume SESSION_ID` — hoạt động tốt, session lưu tại `~/.claude/projects/{key}/{id}.jsonl`
- **Gemini CLI**: Stateless → dùng **Context Injection** (inject 20 turns gần nhất vào prompt)
- **Backup trigger**: 80 messages hoặc 500KB → backup → tạo session mới
- **Naming**: `{AgentName}_{InstanceName}_{SessionName}_{YYYY-MM-DD_HH-mm}.md`
- **Stack**: Telegraf + Express + HTML tĩnh, config JSON, không DB

#### P1.3: src/lib/ — Nền móng ✅ DONE (2026-03-31)
- `src/lib/logger.ts` — ghi log có timestamp giờ VN
- `src/lib/config.ts` — load/save GlobalConfig + AgentProfile
- `src/lib/session.ts` — Claude session path + Gemini history JSONL
- `src/lib/backup.ts` — shouldBackup() + backupSession() + listBackups()
- Build TypeScript: không lỗi ✅

#### P1.4: src/bot/ — Telegram Bot + Adapters ✅ DONE (2026-03-31)
- `src/bot/adapters.ts` — callClaude (--resume) + callGemini (context injection 20 turns)
- `src/bot/telegram-bot.ts` — TelegramBotService: nhận tin, kiểm tra quyền, auto backup, /new /status /backup /help
- `src/bot/manager.ts` — BotManager singleton: start/stop từng bot hoặc tất cả
- Build TypeScript: không lỗi ✅

#### P1.5: src/web/ — Web UI ✅ DONE (2026-03-31)
- `src/web/server.ts` — Express API: login, agents CRUD, backups, logs
- `src/web/public/index.html` — Light theme (giống Claude Desktop): sidebar nav, 4 pages Agents/Sessions/Backups/Logs, accent cam #d4612a, vanilla JS
- Build TypeScript: không lỗi ✅

#### Môi trường dev: Fix Claude_Preview hook ✅ DONE (2026-03-31)
- Hook "[Preview Required]" / "[Verification Required]" từ builtin plugin Claude_Preview block mọi lần edit code
- Fix: `disableAllHooks: true` trong `.claude/settings.local.json` của project + xóa GNS2-UI khỏi launch.json
- Lưu ý: tất cả hooks tắt trong project claude folder (kể cả backup/memory hints)

#### P1.6: Entry point + Setup wizard + Install script ✅ DONE (2026-03-31)
- `src/index.ts` — load config → startWebServer → manager.startAll → SIGINT/SIGTERM graceful shutdown
- `src/setup.ts` — wizard: kiểm tra CLI → port/password → tạo agent đầu tiên
- `install.sh` — kiểm tra Node v18+ + claude/gemini CLI → npm install → build → hướng dẫn
- Build TypeScript: không lỗi ✅

#### install.sh + setup.ts — UX cải tiến ✅ DONE (2026-03-31)
- `install.sh`: detect CLI → chỉ báo có/không, không hỏi cài; build xong hỏi "Setup ngay?" → **1 lần chạy xong hết**
- `setup.ts`: **tự detect port trống** từ 8823; port bị bận → tự tìm port kế tiếp, báo user
- `bcrypt` → `bcryptjs` (pure JS, 0 vulnerabilities, nhẹ hơn 54 packages)
- Sandbox test: fresh install → build → server start — PASSED ✅

#### Web UI — Polish + New Agent + CLI Detection ✅ DONE (2026-03-31)
- Redesign light theme: Inter font, SVG icons, spacing tinh tế, separator · trong meta
- Nút **+ New Agent** → modal tạo agent với auto-detect CLI trên hệ thống
- Backend: `GET /api/system/clis` (quét claude/gemini), `POST /api/agents` (tạo), `DELETE /api/agents/:name`
- CLI card: chỉ hiện CLI đã cài, disable CLI chưa cài, auto-select nếu chỉ có 1
- Login: `admin` / `cola8823` (đã tạo sẵn)

- ✅ Test end-to-end: Telegram ↔ Claude nhớ session — PASSED

#### Bug fixes sau test thực tế ✅ DONE (2026-04-01)
- **409 Conflict**: 2 instance cùng token → fix bằng PID file (`~/.config/gns2/gns2.pid`)
  - Khi `npm start`: tự detect + kill instance cũ, đợi port release, rồi mới start mới
- **EADDRINUSE**: port bận sau restart → `startWebServer()` tự thử port kế tiếp thay vì crash
- **Kết quả**: restart bao nhiêu lần cũng không cần kill thủ công
- GitHub cập nhật: https://github.com/colabotmac-cloud/gns2

#### P1.7: Báo cáo final Phần 1 ✅ DONE (2026-03-31)
Xem: `docs/Part1-Report.md`

---

## PHẦN 1: ✅ HOÀN TẤT (2026-04-01)

---

## PHẦN 2: Agent Instance + Worker Instance Architecture
**Trạng thái: ✅ HOÀN TẤT (2026-04-01)**
**Bắt đầu: 2026-04-01**

### Mục tiêu
Tách kiến trúc thành 2 tầng rõ ràng:
1. [x] Agent Instance — pool AI brain độc lập (claude-cli / gemini-cli)
2. [x] Worker Instance — Telegram bot có memory riêng (conversationLog)
3. [x] Neutral conversation log — source of truth cho memory, cả Claude + Gemini sync vào
4. [x] Swap Agent — đổi AI brain cho Worker, có handoff summary, memory không mất
5. [x] Web UI mới — trang Agents + Workers + Swap modal
6. [x] Báo cáo → `docs/Part2-Report.md`

### Tiến độ chi tiết

#### P2.1: Kiến trúc & Data Model ✅ DONE (2026-04-01)
- Thảo luận và chốt kiến trúc 2 tầng: `arch_log_part2.md`
- `AgentInstance`: id, name, type, sessionId, createdAt
- `WorkerInstance`: id, name, botToken, allowedUsers, systemPrompt, sessionPin, activeAgentId, conversationLog, handoffContext
- `LogEntry`: role, content, timestamp, agentId

#### P2.2: Refactor toàn bộ codebase ✅ DONE (2026-04-01)
- `src/lib/config.ts` — AgentInstance + WorkerInstance CRUD, thư mục `ai-agents/` + `workers/`
- `src/lib/session.ts` — neutral log helpers (appendToLog, getRecentLog, clearLog, getLogStats)
- `src/lib/backup.ts` — backup từ conversationLog thay session file riêng
- `src/bot/adapters.ts` — callClaude/callGemini nhận (agent, worker), Gemini inject từ neutral log, generateHandoffSummary
- `src/bot/telegram-bot.ts` — constructor (worker, agent), `/clearhistory` + PIN thay `/new`
- `src/bot/manager.ts` — swapAgent() với handoff summary, keyed by workerId
- `src/web/server.ts` — `/api/ai-agents` + `/api/workers` endpoints + swap
- `src/web/public/index.html` — UI mới 4 pages với Swap modal
- `src/setup.ts` — wizard tạo Agent trước → Worker sau
- Build TypeScript: 0 lỗi ✅

#### P2.3: Test end-to-end ✅ DONE (2026-04-01)
- ✅ Login web UI
- ✅ Tạo Agent (claude-cli, auto-detect)
- ✅ Tạo Worker (chọn agent từ pool, PIN, system prompt)
- ✅ Delete Worker + Agent
- ✅ APIs: /api/ai-agents, /api/workers, /api/system/clis

---

## PHẦN 2: ✅ HOÀN TẤT (2026-04-01)

---

## PHẦN 3: (TBD)
**Trạng thái: ⏳ Chờ định nghĩa scope**

---

## GHI CHÚ
- Mỗi phần xong → viết báo cáo vào `docs/Part{N}-Report.md`
- Không thêm feature ngoài scope đã chốt
- Đơn giản trước, tối ưu sau
