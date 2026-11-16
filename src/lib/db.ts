import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
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
  SpeakingQuestion,
  StudentRosterEntry,
  Submission,
  UserProfile,
} from '../types';

export function makeSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function buildSubmissionId(
  assignmentId: string,
  questionId: string,
  studentUid: string
): string {
  const clean = `${assignmentId}__${questionId}__${studentUid}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  return clean.slice(0, 128);
}

export async function ensureUserProfile(authUser: User): Promise<UserProfile> {
  const userPath = `users/${authUser.uid}`;
  const email = (authUser.email || '').trim().toLowerCase();
  const isBootstrappedTeacher = email === BOOTSTRAPPED_TEACHER_EMAIL.toLowerCase();

  let existingSnap;
  try {
    existingSnap = await getDoc(doc(db, 'users', authUser.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (existingSnap.exists()) {
    const profile = existingSnap.data() as UserProfile;
    // Sync roster info if student hasn't linked yet or status was updated by teacher
    if (profile.role === 'student' && email) {
      const rosterMatch = await findRosterByEmail(email);
      if (rosterMatch) {
        if (!rosterMatch.linkedUid) {
          try {
            await updateDoc(doc(db, 'studentRoster', rosterMatch.rosterId), {
              linkedUid: authUser.uid,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            console.warn('Could not auto-link roster UID:', err);
          }
        }
        if (rosterMatch.accountStatus !== profile.accountStatus) {
          return {
            ...profile,
            studentId: profile.studentId || rosterMatch.studentId,
            className: profile.className || rosterMatch.className,
            accountStatus: rosterMatch.accountStatus,
          };
        }
      }
    }
    return profile;
  }

  // Check if teacher pre-created this student in studentRoster
  let rosterMatch: StudentRosterEntry | null = null;
  if (!isBootstrappedTeacher && email) {
    rosterMatch = await findRosterByEmail(email);
  }

  const newProfile: Record<string, any> = {
    userId: authUser.uid,
    fullName: (
      rosterMatch?.fullName ||
      authUser.displayName ||
      email.split('@')[0] ||
      'English Learner'
    ).slice(0, 120),
    email: email.slice(0, 200),
    role: isBootstrappedTeacher ? 'teacher' : 'student',
    studentId: (rosterMatch?.studentId || '').slice(0, 40),
    className: (rosterMatch?.className || '').slice(0, 60),
    accountStatus: isBootstrappedTeacher
      ? 'active'
      : rosterMatch?.accountStatus || 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', authUser.uid), newProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, userPath);
  }

  if (rosterMatch && !rosterMatch.linkedUid) {
    try {
      await updateDoc(doc(db, 'studentRoster', rosterMatch.rosterId), {
        linkedUid: authUser.uid,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Roster link failed:', err);
    }
  }

  const createdSnap = await getDoc(doc(db, 'users', authUser.uid));
  return createdSnap.data() as UserProfile;
}

async function findRosterByEmail(email: string): Promise<StudentRosterEntry | null> {
  try {
    const q = query(
      collection(db, 'studentRoster'),
      where('email', '==', email.toLowerCase()),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as StudentRosterEntry;
  } catch (error) {
    console.warn('Roster lookup error:', error);
    return null;
  }
}

export async function updateOwnStudentProfile(
  userId: string,
  updates: { fullName: string; studentId: string; className: string }
): Promise<void> {
  const path = `users/${userId}`;
  try {
    await updateDoc(doc(db, 'users', userId), {
      fullName: updates.fullName.trim().slice(0, 120),
      studentId: updates.studentId.trim().slice(0, 40),
      className: updates.className.trim().slice(0, 60),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
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

// ---------------- STUDENT ROSTER ----------------

export async function addRosterStudent(params: {
  studentId: string;
  fullName: string;
  email: string;
  className: string;
  accountStatus: AccountStatus;
  createdBy: string;
}): Promise<string> {
  const rosterId = makeSafeId('roster');
  const path = `studentRoster/${rosterId}`;
  try {
    await setDoc(doc(db, 'studentRoster', rosterId), {
      rosterId,
      studentId: params.studentId.trim().slice(0, 40),
      fullName: params.fullName.trim().slice(0, 120),
      email: params.email.trim().toLowerCase().slice(0, 200),
      className: params.className.trim().slice(0, 60),
      accountStatus: params.accountStatus,
      linkedUid: '',
      createdBy: params.createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return rosterId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function bulkImportRosterStudents(
  rows: Array<{
    studentId: string;
    fullName: string;
    email: string;
    className: string;
  }>,
  createdBy: string
): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const batch = writeBatch(db);
    let count = 0;
    for (const row of rows.slice(0, 100)) {
      if (!row.studentId.trim() || !row.fullName.trim() || !row.email.trim()) continue;
      const rosterId = makeSafeId('roster');
      batch.set(doc(db, 'studentRoster', rosterId), {
        rosterId,
        studentId: row.studentId.trim().slice(0, 40),
        fullName: row.fullName.trim().slice(0, 120),
        email: row.email.trim().toLowerCase().slice(0, 200),
        className: (row.className.trim() || 'General B1').slice(0, 60),
        accountStatus: 'active',
        linkedUid: '',
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    await batch.commit();
    return count;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'studentRoster');
  }
}

export async function updateRosterStudent(
  entry: StudentRosterEntry,
  updates: {
    studentId: string;
    fullName: string;
    email: string;
    className: string;
    accountStatus: AccountStatus;
  }
): Promise<void> {
  const path = `studentRoster/${entry.rosterId}`;
  try {
    await updateDoc(doc(db, 'studentRoster', entry.rosterId), {
      studentId: updates.studentId.trim().slice(0, 40),
      fullName: updates.fullName.trim().slice(0, 120),
      email: updates.email.trim().toLowerCase().slice(0, 200),
      className: updates.className.trim().slice(0, 60),
      accountStatus: updates.accountStatus,
      updatedAt: serverTimestamp(),
    });
    if (entry.linkedUid) {
      await updateDoc(doc(db, 'users', entry.linkedUid), {
        studentId: updates.studentId.trim().slice(0, 40),
        fullName: updates.fullName.trim().slice(0, 120),
        className: updates.className.trim().slice(0, 60),
        accountStatus: updates.accountStatus,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteRosterStudent(rosterId: string): Promise<void> {
  const path = `studentRoster/${rosterId}`;
  try {
    await deleteDoc(doc(db, 'studentRoster', rosterId));
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

  if (params.isResubmission) {
    try {
      await updateDoc(doc(db, 'submissions', params.submissionId), {
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
      studentUid: params.student.userId,
      studentId: (params.student.studentId || '').slice(0, 40),
      studentName: params.student.fullName.slice(0, 120),
      studentEmail: params.student.email.slice(0, 200),
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
