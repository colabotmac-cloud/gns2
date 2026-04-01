# Architecture Log — GNS 2.0 Phần 2
> Tạo: 2026-04-01 | Ghi lại quyết định kiến trúc trước khi implement
> Nếu có thay đổi → cập nhật file này trước khi code

---

## Kiến trúc 2 tầng: Agent Instance + Worker Instance

### Tầng 1: Agent Instance (pool/kho)
- Tạo trước, độc lập với Worker
- Chọn model ngay lúc tạo (claude-cli hoặc gemini-cli)
- Có session ID riêng (Claude) — tạo khi khởi tạo Agent
- **Không lưu memory** — memory thuộc Worker (xem bên dưới)
- Nhiều Worker có thể tham chiếu cùng 1 Agent type, nhưng mỗi Worker dùng Agent khác nhau (1-to-1 khi active)

```typescript
interface AgentInstance {
  id: string             // uuid
  name: string           // "Claude-Dev", "Gemini-Fast"...
  type: 'claude-cli' | 'gemini-cli'  // | 'llm-api' để sau
  sessionId: string      // Claude --resume (tạo khi init Agent)
  createdAt: string
}
```

---

### Tầng 2: Worker Instance (bot thực sự chạy)
- Có Telegram bot token riêng
- Có system prompt riêng
- Có PIN riêng để xóa session (`/clearhistory`)
- Chọn Agent từ pool khi tạo
- **Lưu neutral conversation log** — source of truth cho memory

```typescript
interface WorkerInstance {
  id: string
  name: string
  botToken: string
  allowedUsers: number[]
  systemPrompt: string
  sessionPin: string           // bcrypt hash
  activeAgentId: string        // Agent đang dùng
  conversationLog: LogEntry[]  // neutral log — master memory
  handoffContext?: string      // summary từ lần swap gần nhất
  createdAt: string
}

interface LogEntry {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  agentId: string  // agent nào trả lời tin này (để trace)
}
```

---

## Memory: Neutral Log + Sync

### Nguyên tắc
- `conversationLog` trong Worker là **nguồn sự thật duy nhất**
- Không phụ thuộc format của CLI nào
- Cả Claude và Gemini đều đọc/ghi vào đây

### Cách sync

**Claude:**
- Sau mỗi response: đọc `~/.claude/projects/{hash}/{sessionId}.jsonl` → extract tin nhắn mới → append vào `conversationLog`
- Claude vẫn dùng `--resume sessionId` như bình thường (native memory)
- Neutral log là bản song song, dùng cho swap

**Gemini:**
- Không có native session → đọc `conversationLog` lấy 20 turns gần nhất → inject vào prompt
- Sau response: append vào `conversationLog` trực tiếp

---

## Swap Agent (Web UI only)

### Flow
```
User click "Swap Agent" trên Web UI
    ↓
Worker đang chạy AI hiện tại
    ↓
Gọi AI hiện tại: "Summarize this conversation in 3-5 sentences for handoff"
    ↓ (nếu timeout/error → swap anyway, handoffContext = "")
    ↓
Lưu summary vào worker.handoffContext
    ↓
Stop agent cũ (session file/history giữ nguyên)
    ↓
Load agent mới
    ↓
Inject vào đầu conversation của agent mới:
  - System prompt (vẫn là của Worker, không đổi)
  - handoffContext (summary từ agent cũ)
  - 20 turns gần nhất từ conversationLog (nếu Gemini)
  - Hoặc new Claude session + handoffContext injected as first message
```

### Trường hợp timeout khi generate summary
- **Swap anyway** — không block user
- `handoffContext = ""` — agent mới bắt đầu không có summary
- Neutral log vẫn đầy đủ → agent mới vẫn có context từ log nếu là Gemini

---

## Web UI — Pages cần có

| Page | Nội dung |
|------|----------|
| **Agents** | Danh sách Agent pool — tạo/xóa/xem (không swap ở đây) |
| **Workers** | Danh sách Worker — tạo/start/stop/swap agent/xem log |
| **Backups** | Xem backup files |
| **Logs** | System logs |

### New Worker flow
```
+ New Worker
  ├── Tên
  ├── Bot Token
  ├── Allowed User IDs
  ├── System Prompt
  ├── PIN (để /clearhistory)
  └── Agent [chọn từ danh sách Agents pool]
```

### New Agent flow
```
+ New Agent
  ├── Tên
  └── Model [claude-cli | gemini-cli]
      → tạo sessionId ngay lúc này
```

---

## Telegram Commands (trong Worker)
| Command | Chức năng |
|---------|-----------|
| `/status` | Xem worker đang dùng agent nào, số tin nhắn |
| `/clearhistory` | Nhập PIN → xóa conversationLog, tạo Claude session mới |
| `/backup` | Backup thủ công |
| `/help` | Danh sách lệnh |

*Swap agent chỉ qua Web UI, không có Telegram command*

---

## Điều chưa chốt (để sau)
- [ ] LLM API group (OpenAI-compatible, Anthropic API...) — placeholder, implement Phần 3+
- [ ] 1 Agent có thể assign cho nhiều Worker không? → hiện tại: không, 1-to-1
- [ ] Giới hạn số lượng LogEntry lưu trong conversationLog? (performance)
- [ ] Export/import conversationLog?

---

## Trạng thái
- [x] Kiến trúc đã thảo luận và thống nhất
- [x] Data model finalize
- [x] Implement — Build TypeScript: 0 lỗi ✅ (2026-04-01)
