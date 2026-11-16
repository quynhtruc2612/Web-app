# Security Specification: B1 Speaking Practice

## 1. Data Invariants

1. **Teacher Role Integrity**: Only verified Google accounts (`email_verified == true`) matching the bootstrapped teacher email (`quynhtruc2612@gmail.com`) or an active teacher record in `/users/{uid}` have teacher permissions. Anonymous Firebase users can never access teacher collections or functions.
2. **Roster & Verification Isolation**: `/studentRoster/{rosterId}` and `/studentVerification/{studentIdKey}` are strictly restricted to teachers (`isTeacher()`). Students and anonymous callers can never `get`, `list`, or write student roster entries. Only non-PII class names are exposed in `/publicConfig/classes` for the Student Entry Form dropdown.
3. **Zero-Trust Student Session Verification**: An anonymous user can create `/studentSessions/{request.auth.uid}` ONLY if Firestore rules verify via `get(/studentVerification/$(studentIdKey))` that the Student ID exists, `accountStatus == 'active'`, and both normalized `fullName` and `className` match the teacher's record, with a bounded short-lived `expiresAt <= request.time + 12h`.
4. **Submission Identity Binding & Isolation**: A student creating a submission must hold an active non-expired `/studentSessions/{request.auth.uid}` document, and `canonicalStudentUid`, `studentId`, `studentName`, and `className` must match that verified session. Students can only `get` submissions matching their own `studentUid` or `canonicalStudentUid`, and `allow list` strictly enforces `resource.data.studentUid == request.auth.uid` without `get()` lookups.
5. **Assignment Visibility & Locking**: Anonymous users without a verified active session cannot submit answers. Students can never read `draft` assignments or submit to `locked`/`draft` assignments.
6. **Recording Duration & Size Caps**: `recordingDuration` is bounded to `0 <= recordingDuration <= 300` seconds. String sizes and array sizes are strictly bounded.
7. **Terminal State & Resubmission Lock**: Once a submission reaches `processingStatus: "feedback_available"`, a student cannot overwrite it unless `resubmissionAllowed == true` and the parent assignment is `open`.
8. **Audio Chunk Master Gate & Progress Isolation**: `/submissions/{submissionId}/audioChunks/{chunkIndex}` is gated by `get()` on the parent submission; `/studentProgress/{canonicalUid}` is isolated to the verified owning student or teacher.
9. **Backend Session Token Authorization**: `/api/assess` verifies both the Firebase Auth ID token (JWKS) and, for students, a short-lived server-signed `X-Student-Session` JWT + live Firestore `/studentSessions/{uid}` verification before accepting audio or invoking Gemini.

## 2. "Dirty Dozen" Attack Payloads (All Must Yield PERMISSION_DENIED)

1. **Unverified Student ID Spoof**: Anonymous user creates `/studentSessions/{uid}` with a non-existent `studentIdKey`.
2. **Identity Hijack via Name/Class Mismatch**: Anonymous user enters valid `studentIdKey` (`B1-001`) with a mismatched `fullNameNormalized` or `classNameNormalized`.
3. **Deactivated Student Entry**: Student whose `accountStatus == 'inactive'` attempts to create `/studentSessions/{uid}`.
4. **Unlimited Session Lifetime**: Anonymous user attempts to create `/studentSessions/{uid}` with `expiresAt` > 12 hours in the future.
5. **Roster Enumeration**: Anonymous student attempts `get` or `list` on `/studentRoster` or `/studentVerification`.
6. **Teacher Privilege Escalation**: Anonymous user attempts to create `/users/{uid}` with `role: "teacher"`.
7. **Impersonated Submission**: Verified Student A creates `/submissions/{id}` with `canonicalStudentUid` or `studentId` belonging to Student B.
8. **Peer Submission Snooping**: Student A attempts `get` on Student B's `/submissions/{id}` or `list` without `studentUid == request.auth.uid`.
9. **Draft / Locked Assignment Tampering**: Student attempts to read a `draft` assignment or submit to a `locked` assignment.
10. **Over-Duration Recording**: Student creates `/submissions/{id}` with `recordingDuration: 450`.
11. **Invalid Score Injection**: Student writes `assessment.grammar_vocabulary.score: 9` or `overallScore: 6.0`.
12. **Shadow Field & ID Poisoning**: Attacker injects unknown key `isAdminBypass: true` or 500-char ID `../admin`.
