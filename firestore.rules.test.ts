/**
 * Firestore Security Rules Test Specification (Dirty Dozen Verification)
 * Run with @firebase/rules-unit-testing against the Firestore emulator.
 */

export const DIRTY_DOZEN_CASES = [
  {
    name: '1. Cross-tenant task read/write must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '2. Unverified email write must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userA', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '3. Owner spoofing on create must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userB', title: 'Spoofed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '4. Shadow field injection must fail',
    path: '/users/userA/courses/c1',
    actor: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', code: 'AI-101', title: 'AI', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '5. Path variable ID poisoning must fail',
    path: '/users/userA/tasks/invalid$id!@#',
    actor: { uid: 'userA', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '6. Orphaned subcollection write without user profile must fail',
    path: '/users/userNoProfile/tasks/task1',
    actor: { uid: 'userNoProfile', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '7. Client-forged createdAt timestamp must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userA', email_verified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '8. Mutating immutable ownerId or createdAt on update must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userB' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '9. Invalid task status enum must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userA', email_verified: true },
    payload: { status: 'Bypassed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '10. Oversized notes payload (>2000 chars) must fail',
    path: '/users/userA/tasks/task1',
    actor: { uid: 'userA', email_verified: true },
    payload: { notes: 'x'.repeat(2500) },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '11. Unbounded learningObjectives array (>20 items) must fail',
    path: '/users/userA/modules/m1',
    actor: { uid: 'userA', email_verified: true },
    payload: { learningObjectives: Array.from({ length: 25 }, (_, i) => `Obj ${i}`) },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '12. Listing /users directory must fail',
    path: '/users',
    actor: { uid: 'userA', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
] as const;
