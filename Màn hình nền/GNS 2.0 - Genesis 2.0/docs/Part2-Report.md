# Báo cáo Phần 2 — GNS 2.0
> Hoàn thành: 2026-04-01

---

## Kết quả

Phần 2 tái cấu trúc toàn bộ hệ thống sang kiến trúc 2 tầng:
- **Agent Instance** — pool AI brain độc lập, chọn model khi tạo
- **Worker Instance** — Telegram bot với memory xuyên suốt qua `conversationLog`
- **Neutral conversation log** — nguồn sự thật duy nhất cho memory, sync cả Claude lẫn Gemini
- **Swap Agent** — đổi AI brain không mất memory, có handoff summary

---

## Kiến trúc

### Tầng 1: Agent Pool
```
AgentInstance
  ├── id (uuid)
  ├── name
  ├── type: 'claude-cli' | 'gemini-cli'
  ├── sessionId  ← Claude --resume
  └── createdAt
```
- Tạo trước, độc lập với Worker
- Nhiều Worker có thể dùng Agent cùng type nhưng mỗi Worker có session riêng

### Tầng 2: Worker Instance
```
WorkerInstance
  ├── id, name
  ├── botToken, allowedUsers
  ├── systemPrompt
  ├── sessionPin (bcrypt hash)
  ├── activeAgentId
  ├── conversationLog: LogEntry[]  ← master memory
  └── handoffContext?  ← summary từ swap gần nhất
```

### Neutral Conversation Log
- Mỗi tin nhắn user/assistant đều append vào `conversationLog`
- Claude: gọi `--resume` bình thường + append vào log sau response
- Gemini: đọc 20 turns gần nhất từ log để inject vào prompt
- Khi swap: generate handoff summary từ log → inject vào agent mới

---

## Những gì đã làm

### `src/lib/config.ts`
- Thay `AgentProfile` bằng `AgentInstance` + `WorkerInstance`
- Thư mục: `~/.config/gns2/ai-agents/` + `~/.config/gns2/workers/`
- Full CRUD cho cả hai

### `src/lib/session.ts`
- Neutral log helpers: `appendToLog`, `getRecentLog`, `clearLog`, `getLogStats`
- Xóa Gemini file-based session (không còn cần)

### `src/lib/backup.ts`
- Backup từ `worker.conversationLog` thay vì session file riêng
- Tên file: `{workerName}_{8chars-workerId}_{datetime}.md`

### `src/bot/adapters.ts`
- `callClaude(agent, worker, prompt, isNew)` — append log sau response
- `callGemini(agent, worker, prompt)` — inject 20 turns từ neutral log
- `generateHandoffSummary(agent, worker)` — gọi AI tóm tắt context, timeout 30s

### `src/bot/telegram-bot.ts`
- Constructor: `(worker: WorkerInstance, agent: AgentInstance)`
- `/clearhistory` + PIN flow thay `/new`
- Append user + assistant messages vào conversationLog sau mỗi lượt

### `src/bot/manager.ts`
- `swapAgent(workerId, newAgentId)`: generate summary → save → restart với agent mới
- Keyed by workerId thay agent name

### `src/web/server.ts`
- `GET/POST/DELETE /api/ai-agents` — quản lý Agent pool
- `GET/POST/DELETE /api/workers` — quản lý Worker instances
- `POST /api/workers/:id/start|stop|swap` — lifecycle control

### `src/web/public/index.html`
- Trang **AI Agents**: danh sách pool, tạo Agent mới với auto-detect CLI
- Trang **Workers**: danh sách workers, tạo Worker mới, Swap Agent modal
- Swap modal: chọn agent mới, hiện thông báo handoff summary sẽ được tạo

---

## Cách hoạt động

```
Tạo Agent → chọn model → có sessionId riêng → lưu vào pool

Tạo Worker → chọn Agent từ pool → có conversationLog riêng

User nhắn Telegram
      ↓
Worker nhận tin → append user message vào conversationLog
      ↓
callAI(agent, worker, prompt)
  ├── Claude: --resume agent.sessionId → response → append vào log
  └── Gemini: inject 20 turns từ log vào prompt → response → append vào log
      ↓
Trả lời Telegram

Swap Agent (Web UI):
  → generateHandoffSummary → worker.handoffContext = summary
  → worker.activeAgentId = newAgentId → restart bot
  → Agent mới nhận: systemPrompt + handoffContext + log injection (Gemini)
```

---

## Đã test
- ✅ Build TypeScript: 0 lỗi
- ✅ Login Web UI
- ✅ Tạo Agent (claude-cli, auto-detect)
- ✅ Tạo Worker (chọn agent, PIN, system prompt)
- ✅ Delete Worker + Agent qua API
- ✅ APIs: /api/ai-agents, /api/workers, /api/system/clis

---

## Ghi chú kỹ thuật
- **Config dir**: `~/.config/gns2/ai-agents/` + `~/.config/gns2/workers/`
- **Swap timeout**: 30s — nếu AI không generate được summary thì swap anyway
- **PIN**: bcrypt hash, dùng `/clearhistory` trên Telegram
- **LogEntry.agentId**: trace được agent nào tạo mỗi tin nhắn
- **Phần 3**: LLM API group (placeholder), scope TBD
