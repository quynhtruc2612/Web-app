# Security Specification: B1 Speaking Practice

## 1. Data Invariants

1. **Role Integrity**: No user may self-assign `role: "teacher"` unless their verified Google token matches the bootstrapped teacher email (`quynhtruc2612@gmail.com`) or an authorized teacher invite. Students can never escalate their own `role` or modify `accountStatus`.
2. **Assignment Visibility & Locking**: Students can never read or list `draft` assignments. Students can never submit answers to `locked` or `draft` assignments (enforced via `get()` on the parent assignment document during submission creation and resubmission).
3. **Submission Ownership & PII Isolation**: Students can only read, list, create, or update their own `submissions` (`studentUid == request.auth.uid`). Teachers can read and list all submissions and student profiles. Students cannot list `/users` or `/studentRoster` belonging to other students.
4. **Recording Duration & Size Caps**: `recordingDuration` is bounded to `0 <= recordingDuration <= 300` seconds (5-minute limit enforced in rules). String sizes and array sizes are strictly bounded to prevent resource exhaustion.
5. **Terminal State & Resubmission Lock**: Once a submission reaches `processingStatus: "feedback_available"`, a student cannot overwrite it unless a teacher sets `resubmissionAllowed: true` and the assignment status is `open`.
6. **Audio Chunk Master Gate**: Access to `/submissions/{submissionId}/audioChunks/{chunkIndex}` is gated by `get()` on the parent `/submissions/{submissionId}` document, restricting reads to the owning student or a verified teacher.
7. **Temporal Integrity**: `createdAt` is immutable after creation and validated with `request.time` on creation; `updatedAt` is validated with `request.time` on create and update.

## 2. "Dirty Dozen" Attack Payloads (All Must Yield PERMISSION_DENIED)

1. **Self-Role Escalation**: Student creates `/users/{uid}` with `role: "teacher"`.
2. **Student Account Reactivation**: Inactive student updates `/users/{uid}` changing `accountStatus` to `"active"`.
3. **Draft Assignment Leak**: Student attempts `get` or `list` on `/assignments/{id}` where `status == "draft"`.
4. **Assignment Tampering**: Student attempts `create` or `update` on `/assignments/{id}`.
5. **Locked Assignment Submission**: Student creates `/submissions/{id}` referencing an assignment whose `status == "locked"`.
6. **Impersonated Submission**: Student creates `/submissions/{id}` with `studentUid` set to another student's UID.
7. **Over-Duration Recording**: Student creates `/submissions/{id}` with `recordingDuration: 450` (> 300s limit).
8. **Invalid Score Injection**: Student writes `assessment.grammar_vocabulary.score: 9` (> 5 limit) or `overallScore: 6.0`.
9. **Peer Submission Snooping**: Student A attempts `get` or `list` on `/submissions/{id}` belonging to Student B.
10. **Unauthorized Resubmission Overwrite**: Student overwrites a `"feedback_available"` submission when `resubmissionAllowed == false`.
11. **Shadow Ghost Field Injection**: User includes unexpected field `isAdminBypass: true` in `/users/{uid}` or `/submissions/{id}`.
12. **ID Poisoning**: Attacker attempts `create` with a 500-character document ID containing special characters (`../admin`).
