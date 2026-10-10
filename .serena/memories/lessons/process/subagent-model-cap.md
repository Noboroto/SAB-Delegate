# Trần model subagent là `sonnet`; tối đa MỘT subagent `opus` cùng lúc

Chủ repo quyết (2026-09-17, áp dụng chung các repo của user: Leaderboard, JudgeHub, QR-Production-Manager, SAB-Delegate).
- Subagent tối đa `sonnet`; ngoại lệ `opus`: `kongming`, hoặc vòng nâng cấp khi agent sửa cùng task 3 vòng vẫn lỗi.
- Tối đa 1 subagent `opus` cùng lúc. Không bao giờ `fable` (kể cả `kongming` — phải ghi đè `model: "opus"`).

**Why**: quota — phiên từng chạm 429 khi agent implement đang làm dở.
**How to apply**: truyền `model: "sonnet"` TƯỜNG MINH ở mọi Agent call (bỏ trống = kế thừa model orchestrator).
Lỡ spawn sai → `TaskStop` rồi spawn lại.
