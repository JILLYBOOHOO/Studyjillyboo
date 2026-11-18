# StudyTrack AI — Firestore Security Specification

## 1. Data Invariants

1. **Strict Ownership Isolation**: Every document under `/users/{userId}` and its subcollections (`courses`, `tasks`, `lectures`, `modules`, `sprints`, `progressReports`, `tutorThreads`, `quizzes`) belongs exclusively to `userId == request.auth.uid` with `request.auth.token.email_verified == true`.
2. **No Orphaned Subcollection Records**: Every subcollection document (`courses`, `tasks`, `lectures`, `modules`, `sprints`, `progressReports`, `tutorThreads`, `quizzes`) requires its parent `/users/{userId}` profile document to exist on creation.
3. **Immutable Ownership & Creation Timestamps**: `ownerId`, `uid`, and `createdAt` cannot be modified after creation. All `createdAt` and `updatedAt` timestamps must match `request.time`.
4. **No Shadow Fields**: Every collection uses `keys().hasAll(...) && keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update.
5. **Bounded Strings & Arrays**: Every string field enforces strict `.size()` bounds; every array enforces `.size() <= MAX` and validates element types when non-empty.
6. **PII Isolation**: No email addresses or phone numbers are persisted in `/users/{userId}`; `allow list` is disabled on `/users`.
7. **Secure List Queries**: Every subcollection `allow list` checks `resource.data.ownerId == request.auth.uid` without `get()`/`exists()` lookups.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Cross-Tenant Read/Write**: User B attempts `get`/`create`/`list` on `/users/userA/tasks/task1` -> `PERMISSION_DENIED`.
2. **Unverified Email Bypass**: Authenticated user with `email_verified: false` attempts to write `/users/userA/tasks/task1` -> `PERMISSION_DENIED`.
3. **Owner Spoofing**: User A creates `/users/userA/tasks/task1` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: User A creates task with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
5. **Path ID Poisoning**: User A writes to `/users/userA/tasks/` with 200-char or `bad$id` document ID -> `PERMISSION_DENIED`.
6. **Orphaned Subcollection Write**: User A creates a task when `/users/userA` does not exist -> `PERMISSION_DENIED`.
7. **Timestamp Forgery**: User A sets `createdAt` to a backdated client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: User A updates task to change `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
9. **Terminal State Violation / Invalid Enum**: User A sets `status: "SuperAdmin"` or `type: "Hacked"` -> `PERMISSION_DENIED`.
10. **Value Poisoning (Type/Size Exhaustion)**: User A updates `notes` with a 50KB string or boolean -> `PERMISSION_DENIED`.
11. **Unbounded Array Exhaustion**: User A creates module with 100 items in `learningObjectives` -> `PERMISSION_DENIED`.
12. **User Directory Enumeration**: Any user attempts `list` on `/users` -> `PERMISSION_DENIED`.
