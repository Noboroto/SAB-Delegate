# Trần model subagent là `sonnet`; tối đa MỘT subagent `opus` cùng lúc

Chủ repo quyết (2026-09-17, áp dụng chung các repo của user: Leaderboard, JudgeHub, QR-Production-Manager, SAB-Delegate).
- Subagent tối đa `sonnet`; ngoại lệ `opus`: `kongming`, hoặc vòng nâng cấp khi agent sửa cùng task 3 vòng vẫn lỗi.
- Tối đa 1 subagent `opus` cùng lúc. Không bao giờ `fable` (kể cả `kongming` — phải ghi đè `model: "opus"`).

**Why**: quota — phiên từng chạm 429 khi agent implement đang làm dở.
**How to apply**: truyền `model: "sonnet"` TƯỜNG MINH ở mọi Agent call (bỏ trống = kế thừa model orchestrator).
Lỡ spawn sai → `TaskStop` rồi spawn lại.

## Bổ sung từ bài học các repo khác (11/10/2026)
- Brief vòng nâng cấp (sau 3 vòng sonnet hỏng cùng task) có 4 điểm: vì sao 3 vòng trước hỏng; sửa MỌI chỗ cùng một invariant trong một lượt; tự review đối kháng trước verify nặng; mọi khẳng định kèm output lệnh thật. Đếm vòng theo task (vòng = fix → verify còn finding). Mẫu prompt: `mem:lessons/process/agent-orchestration`.
