import { signInAnonymously, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_TEACHER_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import type {
  AccountStatus,
  AssessmentApiResponse,
  Assignment,
  AssignmentStatus,
  PublicClassCatalog,
  SpeakingQuestion,
  StudentProgress,
  StudentRosterEntry,
  StudentSession,
  StudentVerificationRecord,
  Submission,
  UserProfile,
} from '../types';

export const FIRESTORE_COLLECTIONS = {
  USERS: 'users',
  ASSIGNMENTS: 'assignments',
  SUBMISSIONS: 'submissions',
  STUDENT_PROGRESS: 'studentProgress',
  STUDENT_ROSTER: 'studentRoster',
  STUDENT_VERIFICATION: 'studentVerification',
  STUDENT_SESSIONS: 'studentSessions',
  PUBLIC_CONFIG: 'publicConfig',
} as const;

const STUDENT_SESSION_TOKEN_KEY = 'b1_speaking_student_session_token';
const STUDENT_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (within 12h rule limit)

export function makeSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function normalizeSpaceText(val: string): string {
  return val.trim().replace(/\s+/g, ' ');
}

export function normalizeStudentIdKey(studentId: string): string {
  return studentId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 40);
}

export function isValidStudentIdKey(key: string): boolean {
  return /^[A-Z0-9_-]{1,40}$/.test(key) && /[A-Z0-9]/.test(key);
}

export function buildSubmissionId(
  assignmentId: string,
  questionId: string,
  studentUid: string
): string {
  const cleanUid = studentUid.replace(/[^a-zA-Z0-9_-]/g, '_');
  const suffix = `__${cleanUid}`;
  const cleanPrefix = `${assignmentId}__${questionId}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, Math.max(1, 128 - suffix.length));
  return `${cleanPrefix}${suffix}`.slice(0, 128);
}

export function computeUniqueClassList(
  entries: Array<{ className: string }>
): string[] {
  const byLower = new Map<string, string>();
  for (const item of entries) {
    const clean = normalizeSpaceText(item.className || '').slice(0, 60);
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!byLower.has(lower)) {
      byLower.set(lower, clean);
    }
  }
  return Array.from(byLower.values())
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 100);
}

// ---------------- TEACHER AUTH PROFILE ----------------

export async function ensureTeacherProfile(authUser: User): Promise<UserProfile> {
  const userPath = `users/${authUser.uid}`;
  const email = (authUser.email || '').trim().toLowerCase();
  const isBootstrappedTeacher =
    Boolean(authUser.emailVerified) &&
    email === BOOTSTRAPPED_TEACHER_EMAIL.toLowerCase();

  let existingSnap;
  try {
    existingSnap = await getDoc(doc(db, 'users', authUser.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (existingSnap.exists()) {
    const profile = existingSnap.data() as UserProfile;
    if (profile.role !== 'teacher' || profile.accountStatus !== 'active') {
      throw new Error('TEACHER_ACCESS_REQUIRED');
    }
    return profile;
  }

  if (!isBootstrappedTeacher) {
    throw new Error('TEACHER_ACCESS_REQUIRED');
  }

  const newProfile = {
    userId: authUser.uid,
    fullName: (authUser.displayName || email.split('@')[0] || 'Teacher').slice(0, 120),
    email: email.slice(0, 200),
    role: 'teacher' as const,
    studentId: '',
    className: '',
    accountStatus: 'active' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', authUser.uid), newProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, userPath);
  }

  const createdSnap = await getDoc(doc(db, 'users', authUser.uid));
  return createdSnap.data() as UserProfile;
}

export async function ensureUserProfile(authUser: User): Promise<UserProfile> {
  return ensureTeacherProfile(authUser);
}

// ---------------- PUBLIC CLASS LIST & VERIFIED STUDENT SESSIONS ----------------

export async function fetchPublicClassList(): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.PUBLIC_CONFIG, 'classes'));
    if (!snap.exists()) return [];
    const data = snap.data() as PublicClassCatalog;
    if (!Array.isArray(data?.classNames)) return [];
    return data.classNames
      .map((c) => normalizeSpaceText(String(c || '')))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.warn('Could not load class catalog:', err);
    return [];
  }
}

export function getStoredStudentSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(STUDENT_SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveStoredStudentSessionToken(token: string): void {
  try {
    window.sessionStorage.setItem(STUDENT_SESSION_TOKEN_KEY, token);
  } catch {
    // ignore storage errors
  }
}

export function clearStoredStudentSessionToken(): void {
  try {
    window.sessionStorage.removeItem(STUDENT_SESSION_TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

async function mintBackendStudentSessionToken(authUser: User): Promise<{
  sessionToken: string;
  expiresAt: number;
  student: {
    canonicalStudentUid: string;
    studentId: string;
    fullName: string;
    className: string;
  };
}> {
  const idToken = await authUser.getIdToken();
  const response = await fetch('/api/student/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.sessionToken) {
    throw new Error(
      data?.error || 'Unable to verify your student speaking session right now.'
    );
  }

  saveStoredStudentSessionToken(data.sessionToken);
  return data;
}

export async function refreshStudentSessionToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user || !user.isAnonymous) {
    throw new Error('Your student session is no longer active. Please enter your details again.');
  }
  const res = await mintBackendStudentSessionToken(user);
  return res.sessionToken;
}

let activeStudentLoginPromise: Promise<UserProfile> | null = null;

export function getActiveStudentLoginPromise(): Promise<UserProfile> | null {
  return activeStudentLoginPromise;
}

export async function startVerifiedStudentSession(params: {
  fullName: string;
  studentId: string;
  className: string;
}): Promise<UserProfile> {
  const run = async (): Promise<UserProfile> => {
    const cleanName = normalizeSpaceText(params.fullName).slice(0, 120);
    const cleanStudentId = params.studentId.trim().slice(0, 40);
    const cleanClass = normalizeSpaceText(params.className).slice(0, 60);
    const studentIdKey = normalizeStudentIdKey(cleanStudentId);

    if (!cleanName || !cleanStudentId || !cleanClass) {
      throw new Error('Please enter your Full Name, Student ID, and select your Class.');
    }
    if (!isValidStudentIdKey(studentIdKey)) {
      throw new Error('Please enter a valid Student ID (letters, numbers, hyphens, or underscores).');
    }

    clearStoredStudentSessionToken();
    if (auth.currentUser) {
      await signOut(auth).catch(() => {});
    }

    let cred;
    try {
      cred = await signInAnonymously(auth);
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/admin-restricted-operation'
      ) {
        throw new Error(
          'ANONYMOUS_AUTH_DISABLED: Anonymous sign-in is not enabled in Firebase Authentication yet. Ask your teacher/admin to enable the Anonymous sign-in provider in Firebase Console.'
        );
      }
      throw new Error(err?.message || 'Unable to start a temporary student session.');
    }

    const uid = cred.user.uid;
    const expiresAtMs = Date.now() + STUDENT_SESSION_TTL_MS;

    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.STUDENT_SESSIONS, uid), {
        sessionUid: uid,
        studentIdKey,
        studentId: cleanStudentId,
        fullName: cleanName,
        fullNameNormalized: cleanName.toLowerCase(),
        className: cleanClass,
        classNameNormalized: cleanClass.toLowerCase(),
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
      });
    } catch (err: any) {
      await signOut(auth).catch(() => {});
      const msg = String(err?.message || '');
      if (err?.code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
        throw new Error(
          'We could not match your Full Name, Student ID, and Class with an active student record. Please check your details or ask your teacher.'
        );
      }
      throw new Error(msg || 'Unable to verify your student record right now.');
    }

    try {
      const issued = await mintBackendStudentSessionToken(cred.user);
      return {
        userId: issued.student.canonicalStudentUid,
        authUid: uid,
        fullName: issued.student.fullName,
        email: '',
        role: 'student',
        studentId: issued.student.studentId,
        className: issued.student.className,
        accountStatus: 'active',
        sessionExpiresAt: issued.expiresAt,
        createdAt: null,
        updatedAt: null,
      };
    } catch (err) {
      await signOut(auth).catch(() => {});
      clearStoredStudentSessionToken();
      throw err;
    }
  };

  const promise = run();
  activeStudentLoginPromise = promise;
  try {
    return await promise;
  } finally {
    if (activeStudentLoginPromise === promise) {
      activeStudentLoginPromise = null;
    }
  }
}

export async function resumeVerifiedStudentSession(
  authUser: User
): Promise<UserProfile | null> {
  if (!authUser.isAnonymous) return null;
  const path = `${FIRESTORE_COLLECTIONS.STUDENT_SESSIONS}/${authUser.uid}`;

  let snap;
  try {
    snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.STUDENT_SESSIONS, authUser.uid));
  } catch {
    return null;
  }

  if (!snap.exists()) return null;
  const data = snap.data() as StudentSession;
  const expiresAtMs =
    typeof data.expiresAt?.toMillis === 'function'
      ? data.expiresAt.toMillis()
      : typeof data.expiresAt?.seconds === 'number'
      ? data.expiresAt.seconds * 1000
      : 0;

  if (data.status !== 'active' || expiresAtMs <= Date.now()) {
    return null;
  }

  try {
    const issued = await mintBackendStudentSessionToken(authUser);
    return {
      userId: issued.student.canonicalStudentUid,
      authUid: authUser.uid,
      fullName: issued.student.fullName,
      email: '',
      role: 'student',
      studentId: issued.student.studentId,
      className: issued.student.className,
      accountStatus: 'active',
      sessionExpiresAt: issued.expiresAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  } catch (err) {
    console.warn(`Could not resume session at ${path}:`, err);
    return null;
  }
}

export async function endStudentSession(): Promise<void> {
  const token = getStoredStudentSessionToken();
  clearStoredStudentSessionToken();

  if (token) {
    await fetch('/api/student/logout', {
      method: 'POST',
      headers: {
        'X-Student-Session': token,
      },
    }).catch(() => {});
  }

  const currentUser = auth.currentUser;
  if (currentUser?.isAnonymous) {
    await updateDoc(doc(db, FIRESTORE_COLLECTIONS.STUDENT_SESSIONS, currentUser.uid), {
      status: 'ended',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  await signOut(auth).catch(() => {});
}

// ---------------- ASSIGNMENTS ----------------

export async function createAssignment(params: {
  weekNumber: number;
  title: string;
  topic: string;
  instructions: string;
  questions: SpeakingQuestion[];
  deadline: string;
  status: AssignmentStatus;
  createdBy: string;
}): Promise<string> {
  const assignmentId = makeSafeId(`wk${String(params.weekNumber).padStart(2, '0')}`);
  const path = `assignments/${assignmentId}`;
  const cleanQuestions = params.questions.slice(0, 20).map((q, idx) => ({
    questionId: q.questionId || makeSafeId(`q${idx + 1}`),
    order: idx + 1,
    prompt: q.prompt.trim().slice(0, 1500),
    tips: (q.tips || '').trim().slice(0, 400),
  }));

  const payload = {
    assignmentId,
    weekNumber: Math.max(1, Math.min(100, Math.round(params.weekNumber))),
    title: params.title.trim().slice(0, 150),
    topic: params.topic.trim().slice(0, 150),
    instructions: params.instructions.trim().slice(0, 2500),
    questions: cleanQuestions,
    questionCount: cleanQuestions.length,
    status: params.status,
    deadline: params.deadline.trim().slice(0, 60),
    createdBy: params.createdBy,
    createdAt: serverTimestamp(),
    publishedAt: params.status === 'open' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'assignments', assignmentId), payload);
    return assignmentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAssignment(
  assignmentId: string,
  params: {
    weekNumber: number;
    title: string;
    topic: string;
    instructions: string;
    questions: SpeakingQuestion[];
    deadline: string;
    status: AssignmentStatus;
    existingPublishedAt: any;
  }
): Promise<void> {
  const path = `assignments/${assignmentId}`;
  const cleanQuestions = params.questions.slice(0, 20).map((q, idx) => ({
    questionId: q.questionId || makeSafeId(`q${idx + 1}`),
    order: idx + 1,
    prompt: q.prompt.trim().slice(0, 1500),
    tips: (q.tips || '').trim().slice(0, 400),
  }));

  try {
    await updateDoc(doc(db, 'assignments', assignmentId), {
      weekNumber: Math.max(1, Math.min(100, Math.round(params.weekNumber))),
      title: params.title.trim().slice(0, 150),
      topic: params.topic.trim().slice(0, 150),
      instructions: params.instructions.trim().slice(0, 2500),
      questions: cleanQuestions,
      questionCount: cleanQuestions.length,
      status: params.status,
      deadline: params.deadline.trim().slice(0, 60),
      publishedAt:
        params.existingPublishedAt || (params.status === 'open' ? serverTimestamp() : null),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setAssignmentStatus(
  assignment: Assignment,
  newStatus: AssignmentStatus
): Promise<void> {
  const path = `assignments/${assignment.assignmentId}`;
  try {
    await updateDoc(doc(db, 'assignments', assignment.assignmentId), {
      status: newStatus,
      publishedAt:
        assignment.publishedAt || (newStatus === 'open' ? serverTimestamp() : null),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  const path = `assignments/${assignmentId}`;
  try {
    await deleteDoc(doc(db, 'assignments', assignmentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ---------------- STUDENT ROSTER & VERIFICATION SYNC ----------------

function buildVerificationPayload(params: {
  studentIdKey: string;
  rosterId: string;
  studentId: string;
  fullName: string;
  className: string;
  accountStatus: AccountStatus;
  updatedBy: string;
}) {
  const cleanName = normalizeSpaceText(params.fullName).slice(0, 120);
  const cleanClass = normalizeSpaceText(params.className).slice(0, 60);
  return {
    studentIdKey: params.studentIdKey,
    rosterId: params.rosterId,
    studentId: params.studentId.trim().slice(0, 40),
    fullName: cleanName,
    fullNameNormalized: cleanName.toLowerCase(),
    className: cleanClass,
    classNameNormalized: cleanClass.toLowerCase(),
    accountStatus: params.accountStatus,
    canonicalStudentUid: `stu_${params.studentIdKey}`,
    updatedBy: params.updatedBy,
    updatedAt: serverTimestamp(),
  };
}

export async function syncRosterVerificationAndClasses(
  roster: StudentRosterEntry[],
  teacherUid: string
): Promise<void> {
  try {
    const [verSnap, classSnap] = await Promise.all([
      getDocs(collection(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION)),
      getDoc(doc(db, FIRESTORE_COLLECTIONS.PUBLIC_CONFIG, 'classes')),
    ]);

    const existingVerByKey = new Map<string, StudentVerificationRecord>();
    verSnap.docs.forEach((d) => {
      const rec = d.data() as StudentVerificationRecord;
      existingVerByKey.set(rec.studentIdKey || d.id, rec);
    });

    const expectedKeys = new Set<string>();
    const batch = writeBatch(db);
    let hasWrites = false;

    for (const r of roster) {
      const cleanStudentId = r.studentId.trim().slice(0, 40);
      const studentIdKey = r.studentIdKey || normalizeStudentIdKey(cleanStudentId);
      if (!isValidStudentIdKey(studentIdKey)) continue;
      expectedKeys.add(studentIdKey);

      const cleanName = normalizeSpaceText(r.fullName).slice(0, 120);
      const cleanClass = normalizeSpaceText(r.className || 'General B1').slice(0, 60);
      if (!cleanName || !cleanClass) continue;

      if (!r.studentIdKey) {
        batch.update(doc(db, FIRESTORE_COLLECTIONS.STUDENT_ROSTER, r.rosterId), {
          studentIdKey,
          fullName: cleanName,
          className: cleanClass,
          updatedAt: serverTimestamp(),
        });
        hasWrites = true;
      }

      const existing = existingVerByKey.get(studentIdKey);
      const needsSync =
        !existing ||
        existing.rosterId !== r.rosterId ||
        existing.studentId !== cleanStudentId ||
        existing.fullNameNormalized !== cleanName.toLowerCase() ||
        existing.classNameNormalized !== cleanClass.toLowerCase() ||
        existing.accountStatus !== r.accountStatus;

      if (needsSync) {
        batch.set(
          doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, studentIdKey),
          buildVerificationPayload({
            studentIdKey,
            rosterId: r.rosterId,
            studentId: cleanStudentId,
            fullName: cleanName,
            className: cleanClass,
            accountStatus: r.accountStatus,
            updatedBy: teacherUid,
          })
        );
        hasWrites = true;
      }
    }

    for (const [key] of existingVerByKey.entries()) {
      if (!expectedKeys.has(key)) {
        batch.delete(doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, key));
        hasWrites = true;
      }
    }

    const desiredClasses = computeUniqueClassList(roster);
    const currentClasses = classSnap.exists()
      ? ((classSnap.data() as PublicClassCatalog).classNames || [])
      : null;
    const classesChanged =
      !currentClasses ||
      currentClasses.length !== desiredClasses.length ||
      currentClasses.some((c, i) => c !== desiredClasses[i]);

    if (classesChanged) {
      batch.set(doc(db, FIRESTORE_COLLECTIONS.PUBLIC_CONFIG, 'classes'), {
        classNames: desiredClasses,
        updatedBy: teacherUid,
        updatedAt: serverTimestamp(),
      });
      hasWrites = true;
    }

    if (hasWrites) {
      await batch.commit();
    }
  } catch (err) {
    console.warn('Verification index sync warning:', err);
  }
}

export async function addRosterStudent(params: {
  studentId: string;
  fullName: string;
  email?: string;
  className: string;
  accountStatus: AccountStatus;
  createdBy: string;
}): Promise<string> {
  const cleanStudentId = params.studentId.trim().slice(0, 40);
  const studentIdKey = normalizeStudentIdKey(cleanStudentId);
  const cleanName = normalizeSpaceText(params.fullName).slice(0, 120);
  const cleanClass = normalizeSpaceText(params.className).slice(0, 60);
  const cleanEmail = (params.email || '').trim().toLowerCase().slice(0, 200);

  if (!cleanStudentId || !isValidStudentIdKey(studentIdKey)) {
    throw new Error('Please enter a valid Student ID.');
  }
  if (!cleanName || !cleanClass) {
    throw new Error('Full Name and Class are required.');
  }

  // Enforce unique Student ID
  const existingVerSnap = await getDoc(
    doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, studentIdKey)
  );
  if (existingVerSnap.exists()) {
    throw new Error(
      `Student ID "${cleanStudentId}" is already assigned to another student. Each student must have a unique Student ID.`
    );
  }

  const rosterId = makeSafeId('roster');
  const path = `studentRoster/${rosterId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, FIRESTORE_COLLECTIONS.STUDENT_ROSTER, rosterId), {
      rosterId,
      studentId: cleanStudentId,
      studentIdKey,
      fullName: cleanName,
      email: cleanEmail,
      className: cleanClass,
      accountStatus: params.accountStatus,
      linkedUid: '',
      createdBy: params.createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, studentIdKey),
      buildVerificationPayload({
        studentIdKey,
        rosterId,
        studentId: cleanStudentId,
        fullName: cleanName,
        className: cleanClass,
        accountStatus: params.accountStatus,
        updatedBy: params.createdBy,
      })
    );
    await batch.commit();
    return rosterId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function bulkImportRosterStudents(
  rows: Array<{
    studentId: string;
    fullName: string;
    email?: string;
    className: string;
  }>,
  createdBy: string,
  existingRoster: StudentRosterEntry[] = []
): Promise<{ imported: number; skippedDuplicates: string[] }> {
  if (rows.length === 0) return { imported: 0, skippedDuplicates: [] };

  const existingKeys = new Set(
    existingRoster.map((r) => r.studentIdKey || normalizeStudentIdKey(r.studentId))
  );
  const skippedDuplicates: string[] = [];

  try {
    const batch = writeBatch(db);
    let count = 0;

    for (const row of rows.slice(0, 100)) {
      const cleanStudentId = row.studentId.trim().slice(0, 40);
      const studentIdKey = normalizeStudentIdKey(cleanStudentId);
      const cleanName = normalizeSpaceText(row.fullName).slice(0, 120);
      const cleanClass = normalizeSpaceText(row.className || 'General B1').slice(0, 60);
      const cleanEmail = (row.email || '').trim().toLowerCase().slice(0, 200);

      if (!cleanStudentId || !isValidStudentIdKey(studentIdKey) || !cleanName) {
        continue;
      }

      if (existingKeys.has(studentIdKey)) {
        skippedDuplicates.push(cleanStudentId);
        continue;
      }
      existingKeys.add(studentIdKey);

      const rosterId = makeSafeId('roster');
      batch.set(doc(db, FIRESTORE_COLLECTIONS.STUDENT_ROSTER, rosterId), {
        rosterId,
        studentId: cleanStudentId,
        studentIdKey,
        fullName: cleanName,
        email: cleanEmail,
        className: cleanClass,
        accountStatus: 'active',
        linkedUid: '',
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, studentIdKey),
        buildVerificationPayload({
          studentIdKey,
          rosterId,
          studentId: cleanStudentId,
          fullName: cleanName,
          className: cleanClass,
          accountStatus: 'active',
          updatedBy: createdBy,
        })
      );
      count++;
    }

    if (count > 0) {
      await batch.commit();
    }
    return { imported: count, skippedDuplicates };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'studentRoster');
  }
}

export async function updateRosterStudent(
  entry: StudentRosterEntry,
  updates: {
    studentId: string;
    fullName: string;
    email?: string;
    className: string;
    accountStatus: AccountStatus;
  },
  updatedBy = entry.createdBy
): Promise<void> {
  const path = `studentRoster/${entry.rosterId}`;
  const cleanStudentId = updates.studentId.trim().slice(0, 40);
  const newKey = normalizeStudentIdKey(cleanStudentId);
  const oldKey = entry.studentIdKey || normalizeStudentIdKey(entry.studentId);
  const cleanName = normalizeSpaceText(updates.fullName).slice(0, 120);
  const cleanClass = normalizeSpaceText(updates.className).slice(0, 60);
  const cleanEmail = (updates.email || '').trim().toLowerCase().slice(0, 200);

  if (!cleanStudentId || !isValidStudentIdKey(newKey)) {
    throw new Error('Please enter a valid Student ID.');
  }
  if (!cleanName || !cleanClass) {
    throw new Error('Full Name and Class are required.');
  }

  if (newKey !== oldKey) {
    const conflictSnap = await getDoc(
      doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, newKey)
    );
    if (
      conflictSnap.exists() &&
      (conflictSnap.data() as StudentVerificationRecord).rosterId !== entry.rosterId
    ) {
      throw new Error(
        `Student ID "${cleanStudentId}" belongs to another student. Please choose a unique Student ID.`
      );
    }
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, FIRESTORE_COLLECTIONS.STUDENT_ROSTER, entry.rosterId), {
      studentId: cleanStudentId,
      studentIdKey: newKey,
      fullName: cleanName,
      email: cleanEmail,
      className: cleanClass,
      accountStatus: updates.accountStatus,
      updatedAt: serverTimestamp(),
    });

    if (oldKey && oldKey !== newKey) {
      batch.delete(doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, oldKey));
    }

    batch.set(
      doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, newKey),
      buildVerificationPayload({
        studentIdKey: newKey,
        rosterId: entry.rosterId,
        studentId: cleanStudentId,
        fullName: cleanName,
        className: cleanClass,
        accountStatus: updates.accountStatus,
        updatedBy,
      })
    );

    await batch.commit();

    if (entry.linkedUid) {
      await updateDoc(doc(db, 'users', entry.linkedUid), {
        studentId: cleanStudentId,
        fullName: cleanName,
        className: cleanClass,
        accountStatus: updates.accountStatus,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setRosterStudentStatus(
  entry: StudentRosterEntry,
  accountStatus: AccountStatus,
  updatedBy: string
): Promise<void> {
  return updateRosterStudent(
    entry,
    {
      studentId: entry.studentId,
      fullName: entry.fullName,
      email: entry.email || '',
      className: entry.className,
      accountStatus,
    },
    updatedBy
  );
}

export async function deleteRosterStudent(
  entry: StudentRosterEntry
): Promise<void> {
  const path = `studentRoster/${entry.rosterId}`;
  const studentIdKey = entry.studentIdKey || normalizeStudentIdKey(entry.studentId);
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, FIRESTORE_COLLECTIONS.STUDENT_ROSTER, entry.rosterId));
    if (isValidStudentIdKey(studentIdKey)) {
      batch.delete(
        doc(db, FIRESTORE_COLLECTIONS.STUDENT_VERIFICATION, studentIdKey)
      );
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ---------------- SUBMISSIONS ----------------

export async function createOrReplaceProcessingSubmission(params: {
  submissionId: string;
  isResubmission: boolean;
  student: UserProfile;
  assignment: Assignment;
  question: SpeakingQuestion;
  audioStorageType: 'firebase_storage' | 'firestore_chunks';
  audioStoragePath: string;
  audioMimeType: string;
  audioChunkCount: number;
  recordingDuration: number;
}): Promise<void> {
  const path = `submissions/${params.submissionId}`;
  const cleanDuration = Math.max(0, Math.min(300, Math.round(params.recordingDuration)));
  const sessionAuthUid =
    auth.currentUser?.uid || params.student.authUid || params.student.userId;
  const canonicalUid = params.student.userId;

  if (params.isResubmission) {
    try {
      await updateDoc(doc(db, 'submissions', params.submissionId), {
        studentUid: sessionAuthUid,
        canonicalStudentUid: canonicalUid,
        studentId: (params.student.studentId || '').slice(0, 40),
        studentName: params.student.fullName.slice(0, 120),
        className: (params.student.className || 'General B1').slice(0, 60),
        questionPromptSnapshot: params.question.prompt.slice(0, 1500),
        audioStorageType: params.audioStorageType,
        audioStoragePath: params.audioStoragePath.slice(0, 400),
        audioMimeType: params.audioMimeType.slice(0, 100),
        audioChunkCount: params.audioChunkCount,
        recordingDuration: cleanDuration,
        processingStatus: 'processing',
        transcript: '',
        assessment: null,
        overallScore: null,
        whatYouDidWell: [],
        areasToImprove: [],
        expressionCorrections: [],
        overallComment: '',
        aiModel: '',
        promptVersion: '',
        errorMessage: '',
        resubmissionAllowed: false,
        submittedAt: serverTimestamp(),
        assessedAt: null,
        updatedAt: serverTimestamp(),
      });
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  try {
    await setDoc(doc(db, 'submissions', params.submissionId), {
      submissionId: params.submissionId,
      studentUid: sessionAuthUid,
      canonicalStudentUid: canonicalUid,
      studentId: (params.student.studentId || '').slice(0, 40),
      studentName: params.student.fullName.slice(0, 120),
      studentEmail: (params.student.email || '').slice(0, 200),
      className: (params.student.className || 'General B1').slice(0, 60),
      assignmentId: params.assignment.assignmentId,
      weekNumber: params.assignment.weekNumber,
      assignmentTitle: params.assignment.title.slice(0, 150),
      questionId: params.question.questionId,
      questionPromptSnapshot: params.question.prompt.slice(0, 1500),
      audioStorageType: params.audioStorageType,
      audioStoragePath: params.audioStoragePath.slice(0, 400),
      audioMimeType: params.audioMimeType.slice(0, 100),
      audioChunkCount: params.audioChunkCount,
      recordingDuration: cleanDuration,
      processingStatus: 'processing',
      transcript: '',
      assessment: null,
      overallScore: null,
      whatYouDidWell: [],
      areasToImprove: [],
      expressionCorrections: [],
      overallComment: '',
      aiModel: '',
      promptVersion: '',
      errorMessage: '',
      resubmissionAllowed: false,
      submittedAt: serverTimestamp(),
      assessedAt: null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveSubmissionAssessmentResult(
  submissionId: string,
  result: AssessmentApiResponse
): Promise<void> {
  const path = `submissions/${submissionId}`;
  const isNeedsRerecording = result.assessment_status === 'needs_rerecording';

  try {
    await updateDoc(doc(db, 'submissions', submissionId), {
      processingStatus: isNeedsRerecording ? 'needs_rerecording' : 'feedback_available',
      transcript: (result.transcript || '').slice(0, 15000),
      assessment: isNeedsRerecording ? null : result.assessment,
      overallScore: isNeedsRerecording ? null : result.overallScore,
      whatYouDidWell: (result.what_you_did_well || []).slice(0, 10),
      areasToImprove: (result.areas_to_improve || []).slice(0, 10),
      expressionCorrections: (result.expression_corrections || []).slice(0, 20),
      overallComment: (result.overall_comment || '').slice(0, 3000),
      aiModel: (result.aiModel || '').slice(0, 100),
      promptVersion: (result.promptVersion || '').slice(0, 40),
      errorMessage: isNeedsRerecording
        ? (result.overall_comment || 'Recording requires re-recording.').slice(0, 1000)
        : '',
      assessedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markSubmissionProcessingStatus(
  submissionId: string,
  status: 'processing' | 'failed',
  errorMessage = ''
): Promise<void> {
  const path = `submissions/${submissionId}`;
  try {
    await updateDoc(doc(db, 'submissions', submissionId), {
      processingStatus: status,
      errorMessage: errorMessage.slice(0, 1000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setSubmissionResubmissionAllowed(
  submissionId: string,
  allowed: boolean
): Promise<void> {
  const path = `submissions/${submissionId}`;
  try {
    await updateDoc(doc(db, 'submissions', submissionId), {
      resubmissionAllowed: allowed,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------- STUDENT PROGRESS & COLLECTION INITIALIZERS ----------------

export async function initializeUsersCollection(
  authUser: User
): Promise<UserProfile> {
  return ensureTeacherProfile(authUser);
}

export async function initializeAssignmentsCollection(params: {
  weekNumber: number;
  title: string;
  topic: string;
  instructions: string;
  questions: SpeakingQuestion[];
  deadline: string;
  status: AssignmentStatus;
  createdBy: string;
}): Promise<string> {
  return createAssignment(params);
}

export async function initializeSubmissionsCollection(params: {
  submissionId: string;
  isResubmission: boolean;
  student: UserProfile;
  assignment: Assignment;
  question: SpeakingQuestion;
  audioStorageType: 'firebase_storage' | 'firestore_chunks';
  audioStoragePath: string;
  audioMimeType: string;
  audioChunkCount: number;
  recordingDuration: number;
}): Promise<void> {
  return createOrReplaceProcessingSubmission(params);
}

export async function initializeStudentProgressCollection(
  student: Pick<UserProfile, 'userId' | 'studentId'>
): Promise<StudentProgress> {
  const path = `${FIRESTORE_COLLECTIONS.STUDENT_PROGRESS}/${student.userId}`;
  const docRef = doc(db, FIRESTORE_COLLECTIONS.STUDENT_PROGRESS, student.userId);

  let existingSnap;
  try {
    existingSnap = await getDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (existingSnap.exists()) {
    return existingSnap.data() as StudentProgress;
  }

  const initialDoc = {
    studentUid: student.userId,
    studentId: (student.studentId || '').slice(0, 40),
    totalAssignments: 0,
    completedAssignments: 0,
    totalQuestionsSubmitted: 0,
    averageGrammarVocabulary: null,
    averageDiscourseManagement: null,
    averagePronunciation: null,
    averageOverallScore: null,
    latestSubmissionDate: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(docRef, initialDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  const createdSnap = await getDoc(docRef);
  return createdSnap.data() as StudentProgress;
}

export async function recalculateAndSyncStudentProgress(
  student: Pick<UserProfile, 'userId' | 'studentId'>,
  knownAssignments?: Assignment[],
  knownSubmissions?: Submission[]
): Promise<StudentProgress> {
  const path = `${FIRESTORE_COLLECTIONS.STUDENT_PROGRESS}/${student.userId}`;
  await initializeStudentProgressCollection(student);

  let assignmentsList = knownAssignments;
  if (!assignmentsList) {
    try {
      const assignSnap = await getDocs(
        query(
          collection(db, FIRESTORE_COLLECTIONS.ASSIGNMENTS),
          where('status', 'in', ['open', 'locked'])
        )
      );
      assignmentsList = assignSnap.docs.map((d) => d.data() as Assignment);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.LIST,
        FIRESTORE_COLLECTIONS.ASSIGNMENTS
      );
    }
  }

  let submissionsList = knownSubmissions;
  if (!submissionsList) {
    const resolved: Submission[] = [];
    for (const week of assignmentsList) {
      for (const q of week.questions) {
        const subId = buildSubmissionId(
          week.assignmentId,
          q.questionId,
          student.userId
        );
        try {
          const snap = await getDoc(
            doc(db, FIRESTORE_COLLECTIONS.SUBMISSIONS, subId)
          );
          if (snap.exists()) {
            resolved.push(snap.data() as Submission);
          }
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.GET,
            `${FIRESTORE_COLLECTIONS.SUBMISSIONS}/${subId}`
          );
        }
      }
    }
    submissionsList = resolved;
  }

  const publishedAssignments = assignmentsList.filter((a) => a.status !== 'draft');
  const assessed = submissionsList.filter(
    (s) => s.processingStatus === 'feedback_available' && s.assessment !== null
  );

  let completedAssignments = 0;
  for (const week of publishedAssignments) {
    const weekAssessed = assessed.filter(
      (s) => s.assignmentId === week.assignmentId
    );
    if (week.questions.length > 0 && weekAssessed.length >= week.questions.length) {
      completedAssignments++;
    }
  }

  const roundOne = (n: number) => Math.round(n * 10) / 10;
  let avgGV: number | null = null;
  let avgDM: number | null = null;
  let avgPR: number | null = null;
  let avgOverall: number | null = null;

  if (assessed.length > 0) {
    const count = assessed.length;
    avgGV = roundOne(
      assessed.reduce((acc, s) => acc + s.assessment!.grammar_vocabulary.score, 0) /
        count
    );
    avgDM = roundOne(
      assessed.reduce(
        (acc, s) => acc + s.assessment!.discourse_management.score,
        0
      ) / count
    );
    avgPR = roundOne(
      assessed.reduce((acc, s) => acc + s.assessment!.pronunciation.score, 0) /
        count
    );
    avgOverall = roundOne(
      assessed.reduce(
        (acc, s) => acc + (s.overallScore ?? s.assessment!.overall_score),
        0
      ) / count
    );
  }

  const sortedByDate = [...submissionsList]
    .filter((s) => Boolean(s.submittedAt))
    .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
  const latestSubmissionDate = sortedByDate[0]?.submittedAt || null;

  try {
    await updateDoc(doc(db, FIRESTORE_COLLECTIONS.STUDENT_PROGRESS, student.userId), {
      studentId: (student.studentId || '').slice(0, 40),
      totalAssignments: publishedAssignments.length,
      completedAssignments,
      totalQuestionsSubmitted: submissionsList.length,
      averageGrammarVocabulary: avgGV,
      averageDiscourseManagement: avgDM,
      averagePronunciation: avgPR,
      averageOverallScore: avgOverall,
      latestSubmissionDate,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  const updatedSnap = await getDoc(
    doc(db, FIRESTORE_COLLECTIONS.STUDENT_PROGRESS, student.userId)
  );
  return updatedSnap.data() as StudentProgress;
}

export async function initializeFirestoreCollections(authUser: User): Promise<{
  profile: UserProfile;
  progress: StudentProgress | null;
  collectionsInitialized: string[];
}> {
  const profile = await initializeUsersCollection(authUser);
  const collectionsInitialized: string[] = [
    FIRESTORE_COLLECTIONS.USERS,
    FIRESTORE_COLLECTIONS.ASSIGNMENTS,
    FIRESTORE_COLLECTIONS.SUBMISSIONS,
  ];

  return {
    profile,
    progress: null,
    collectionsInitialized,
  };
}
