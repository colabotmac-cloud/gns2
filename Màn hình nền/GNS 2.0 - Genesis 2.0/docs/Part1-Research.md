# Phần 1 — Nghiên cứu: Telegram Core + Session Memory
> Ngày: 2026-03-31 | Dựa trên: g-tool hiện tại tại VPS `/home/cola_macbook/g-tool/`

---

## 1. Kết quả nghiên cứu: Các CLI đang hoạt động

### Claude Code CLI
- **Version:** 2.1.83
- **Binary:** `/usr/local/bin/claude`
- **Kết nối Telegram:** Dùng thư viện **Telegraf** (long polling), hoạt động tốt
- **Session:** CÓ hỗ trợ — `supportsSession: true`

**Cách gọi:**
```bash
# Session mới
claude --print --permission-mode bypassPermissions \
       --max-turns 5 --output-format text \
       --session-id SESSION_ID "prompt"

# Resume session cũ
claude --print --permission-mode bypassPermissions \
       --max-turns 5 --output-format text \
       --resume SESSION_ID "prompt"
```

**Session file lưu tại:**
```
~/.claude/projects/{workingDir-slashes-to-dashes}/{sessionId}.jsonl
# Ví dụ workingDir=/home/cola_macbook → key=-home-cola_macbook
# → ~/.claude/projects/-home-cola_macbook/{sessionId}.jsonl
```

---

### Gemini CLI
- **Version:** 0.29.5
- **Binary:** `/usr/bin/gemini`
- **Kết nối Telegram:** Dùng Telegraf, hoạt động nhưng **STATELESS**
- **Session:** KHÔNG hỗ trợ — `supportsSession: false`

**Cách gọi hiện tại:**
```bash
gemini -p "prompt"
```

**Vấn đề:** Mỗi lần gọi là một cuộc hội thoại riêng biệt — Gemini không nhớ gì từ lần trước.

**Giải pháp cho GNS 2.0:** Context Injection
- Duy trì file lịch sử hội thoại local (JSONL hoặc Markdown)
- Trước mỗi lần gọi: ghép N tin nhắn gần nhất vào prompt
- Format: `[Lịch sử trước]\n---\nUser: {prompt mới}`
- Giới hạn: chỉ inject ~10-20 turns gần nhất để tránh prompt quá dài

---

## 2. Cơ chế kết nối Telegram (chung cho cả 2 CLI)

```
User (Telegram) → Bot Token → Telegraf (polling) → TelegramBotService
                                                          ↓
                                                   CliAdapter.call()
                                                   ↙              ↘
                                          claudeAdapter       geminiAdapter
                                          (--resume)          (inject history)
                                                          ↓
                                               Response → Telegram reply
```

**Cấu hình mỗi agent (Profile):**
```json
{
  "name": "my-agent",
  "botToken": "BOT_TOKEN",
  "allowedUsers": [6597520958],
  "sessionId": "uuid-cố-định",
  "workingDir": "/home/cola_macbook",
  "cli": "claude",
  "maxTurns": 5,
  "timeoutMs": 180000
}
```

---

## 3. Session Memory cố định — Thiết kế GNS 2.0

### Nguyên tắc
- Mỗi agent instance có **1 sessionId cố định** → lưu trong profile.json
- Session không bao giờ tự xoá, trừ khi user gõ `/new`
- Khi khởi động lại: kiểm tra session file → resume nếu tồn tại

### Session file location (Claude)
```
~/.claude/projects/{key}/{sessionId}.jsonl
```

### Session file location (Gemini - GNS 2.0)
```
~/.config/gns2/sessions/{agentName}/{sessionId}.jsonl
# Tự quản lý, format JSONL tương tự Claude
```

---

## 4. Backup trước khi Compact — Thiết kế GNS 2.0

### Trigger backup khi nào?
Claude tự compact khi context gần đầy. GNS 2.0 cần backup **trước** khi compact.

**Cách detect:** Đọc JSONL file → đếm số messages. Khi vượt ngưỡng → backup.
- Ngưỡng mặc định: **80 messages** hoặc file > **500KB**
- Kiểm tra mỗi lần nhận message

### Naming convention (đã chốt)
```
{AgentName}_{InstanceName}_{SessionName}_{YYYY-MM-DD_HH-mm}.md

Ví dụ:
claude_main-agent_abc123de_2026-03-31_15-30.md
gemini_research-bot_def456fg_2026-03-31_09-00.md
```

### Backup flow
```
Nhận message → Kiểm tra JSONL size
     ↓ (nếu > ngưỡng)
Backup JSONL → session-backup/{tên chuẩn}.md
     ↓
Tạo session mới (compact xong)
     ↓
Tiếp tục xử lý message
```

### Thư mục backup
```
/home/ryan/Màn hình nền/GNS 2.0 - Genesis 2.0/session-backup/
└── claude_main_abc123_2026-03-31_15-30.md
└── gemini_bot1_def456_2026-03-31_09-00.md
```

---

## 5. Web UI — Yêu cầu tối thiểu

**Stack:** Express + HTML tĩnh (không React, không build step)

**Trang cần có:**
1. **Agents** — danh sách agents, trạng thái online/offline, CLI type
2. **Sessions** — session ID, số messages, kích thước file
3. **Session Backup** — danh sách file backup, có thể xem nội dung
4. **Logs** — log realtime của từng agent

**API cần có:**
```
GET  /api/agents           → danh sách agents
GET  /api/sessions         → danh sách sessions
GET  /api/sessions/backups → danh sách file backup
GET  /api/sessions/view/:file → nội dung 1 backup file
GET  /api/logs/:agent      → log của agent
POST /api/agents/start/:name   → start agent
POST /api/agents/stop/:name    → stop agent
```

---

## 6. Quyết định thiết kế GNS 2.0

| Vấn đề | Quyết định |
|--------|-----------|
| Claude session | `--resume SESSION_ID` — giữ nguyên cách cũ |
| Gemini session | Context injection: inject 20 turns vào prompt |
| Session storage | Local file `~/.config/gns2/` — không cần Google Drive |
| Backup trigger | 80 messages hoặc 500KB |
| Backup format | Markdown (human-readable) |
| Backup location | `GNS 2.0 - Genesis 2.0/session-backup/` (workspace) |
| Telegram lib | Telegraf — đã proven |
| Web UI | Express + HTML tĩnh, không framework nặng |
| Config | JSON file per agent, không database |

---

## 7. Cấu trúc thư mục GNS 2.0

```
~/.config/gns2/
├── config.json              ← global config (port, auth)
├── agents/
│   └── {name}.json          ← profile từng agent
├── sessions/
│   └── {agentName}/
│       └── {sessionId}.jsonl  ← session history (Gemini tự quản lý)
└── logs/
    └── {agentName}.log

GNS 2.0 - Genesis 2.0/session-backup/   ← backup tập trung tại workspace
└── {AgentName}_{Instance}_{Session}_{YYYY-MM-DD_HH-mm}.md
```

---

## 8. Next Steps (Phần 1 còn lại)

- [ ] **P1.3** — Implement: TelegramBotService + 2 adapters (Claude resume + Gemini inject)
- [ ] **P1.3** — Implement: Backup service (detect threshold → backup → new session)
- [ ] **P1.4** — Implement: Web UI (Express + HTML)
- [ ] **P1.5** — Viết báo cáo final sau khi code xong + test

---

*Nghiên cứu bởi: claude-code | 2026-03-31*
