export type UserRole = 'teacher' | 'student';
export type AccountStatus = 'active' | 'inactive';
export type AssignmentStatus = 'draft' | 'open' | 'locked';
export type ProcessingStatus =
  | 'processing'
  | 'feedback_available'
  | 'failed'
  | 'needs_rerecording';

export interface UserProfile {
  userId: string;
  authUid?: string;
  fullName: string;
  email: string;
  role: UserRole;
  studentId: string;
  className: string;
  accountStatus: AccountStatus;
  sessionExpiresAt?: number;
  createdAt: any;
  updatedAt: any;
}

export interface StudentRosterEntry {
  rosterId: string;
  studentId: string;
  studentIdKey?: string;
  fullName: string;
  email: string;
  className: string;
  accountStatus: AccountStatus;
  linkedUid: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export interface StudentVerificationRecord {
  studentIdKey: string;
  rosterId: string;
  studentId: string;
  fullName: string;
  fullNameNormalized: string;
  className: string;
  classNameNormalized: string;
  accountStatus: AccountStatus;
  canonicalStudentUid: string;
  updatedBy: string;
  updatedAt: any;
}

export interface StudentSession {
  sessionUid: string;
  studentIdKey: string;
  studentId: string;
  fullName: string;
  fullNameNormalized: string;
  className: string;
  classNameNormalized: string;
  status: 'active' | 'ended';
  createdAt: any;
  updatedAt: any;
  expiresAt: any;
}

export interface PublicClassCatalog {
  classNames: string[];
  updatedBy: string;
  updatedAt: any;
}

export interface SpeakingQuestion {
  questionId: string;
  order: number;
  prompt: string;
  tips?: string;
}

export interface Assignment {
  assignmentId: string;
  weekNumber: number;
  title: string;
  topic: string;
  instructions: string;
  questions: SpeakingQuestion[];
  questionCount: number;
  status: AssignmentStatus;
  deadline: string;
  createdBy: string;
  createdAt: any;
  publishedAt: any;
  updatedAt: any;
}

export interface CriterionDetail {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

export interface PronunciationDetail extends CriterionDetail {
  evidence: string[];
}

export interface SpeakingAssessment {
  grammar_vocabulary: CriterionDetail;
  discourse_management: CriterionDetail;
  pronunciation: PronunciationDetail;
  overall_score: number;
}

export interface ExpressionCorrection {
  original: string;
  improved: string;
  explanation: string;
}

export interface Submission {
  submissionId: string;
  studentUid: string;
  canonicalStudentUid?: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  className: string;
  assignmentId: string;
  weekNumber: number;
  assignmentTitle: string;
  questionId: string;
  questionPromptSnapshot: string;
  audioStorageType: 'firebase_storage' | 'firestore_chunks' | 'none';
  audioStoragePath: string;
  audioMimeType: string;
  audioChunkCount: number;
  recordingDuration: number;
  processingStatus: ProcessingStatus;
  transcript: string;
  assessment: SpeakingAssessment | null;
  overallScore: number | null;
  whatYouDidWell: string[];
  areasToImprove: string[];
  expressionCorrections: ExpressionCorrection[];
  overallComment: string;
  aiModel: string;
  promptVersion: string;
  errorMessage: string;
  resubmissionAllowed: boolean;
  submittedAt: any;
  assessedAt: any;
  updatedAt: any;
}

export interface AssessmentApiResponse {
  transcript: string;
  assessment: SpeakingAssessment | null;
  overallScore: number | null;
  what_you_did_well: string[];
  areas_to_improve: string[];
  expression_corrections: ExpressionCorrection[];
  overall_comment: string;
  assessment_status: 'completed' | 'needs_rerecording';
  reason?: string;
  aiModel: string;
  promptVersion: string;
}

export interface StudentProgress {
  studentUid: string;
  studentId: string;
  totalAssignments: number;
  completedAssignments: number;
  totalQuestionsSubmitted: number;
  averageGrammarVocabulary: number | null;
  averageDiscourseManagement: number | null;
  averagePronunciation: number | null;
  averageOverallScore: number | null;
  latestSubmissionDate: any;
  createdAt: any;
  updatedAt: any;
}
