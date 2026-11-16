import type { Assignment, StudentRosterEntry, Submission, UserProfile } from '../types';

export interface WeeklyStudentSummary {
  studentKey: string;
  studentUid: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  className: string;
  completedQuestions: number;
  totalQuestions: number;
  status: 'Not Started' | 'In Progress' | 'Processing' | 'Feedback Available' | 'Needs Re-recording' | 'Failed';
  averageScore: number | null;
  latestSubmittedAt: Date | null;
  submissions: Submission[];
}

export function toJsDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

export function formatDateShort(ts: any): string {
  const d = toJsDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(ts: any): string {
  const d = toJsDate(ts);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function calculateAssignmentAverageForSubmissions(
  subs: Submission[]
): {
  average: number | null;
  assessedCount: number;
  hasPending: boolean;
} {
  const hasPending = subs.some((s) => s.processingStatus === 'processing');
  const validScores = subs
    .filter(
      (s) =>
        s.processingStatus === 'feedback_available' &&
        typeof s.overallScore === 'number'
    )
    .map((s) => s.overallScore as number);

  if (validScores.length === 0 || hasPending) {
    return {
      average: null,
      assessedCount: validScores.length,
      hasPending,
    };
  }

  const sum = validScores.reduce((acc, v) => acc + v, 0);
  return {
    average: Math.round((sum / validScores.length) * 10) / 10,
    assessedCount: validScores.length,
    hasPending: false,
  };
}

export function computeCriterionAverages(subs: Submission[]): {
  grammarVocabulary: number | null;
  discourseManagement: number | null;
  pronunciation: number | null;
  overall: number | null;
  assessedCount: number;
} {
  const assessed = subs.filter(
    (s) => s.processingStatus === 'feedback_available' && s.assessment !== null
  );
  if (assessed.length === 0) {
    return {
      grammarVocabulary: null,
      discourseManagement: null,
      pronunciation: null,
      overall: null,
      assessedCount: 0,
    };
  }

  let gv = 0;
  let dm = 0;
  let pr = 0;
  let ov = 0;

  for (const s of assessed) {
    gv += s.assessment!.grammar_vocabulary.score;
    dm += s.assessment!.discourse_management.score;
    pr += s.assessment!.pronunciation.score;
    ov += s.overallScore ?? s.assessment!.overall_score;
  }

  const n = assessed.length;
  return {
    grammarVocabulary: Math.round((gv / n) * 10) / 10,
    discourseManagement: Math.round((dm / n) * 10) / 10,
    pronunciation: Math.round((pr / n) * 10) / 10,
    overall: Math.round((ov / n) * 10) / 10,
    assessedCount: n,
  };
}

export function identifyWeakestCriterion(subs: Submission[]): {
  criterionName: string;
  averageScore: number;
  tips: string[];
} | null {
  const avgs = computeCriterionAverages(subs);
  if (
    avgs.assessedCount === 0 ||
    avgs.grammarVocabulary === null ||
    avgs.discourseManagement === null ||
    avgs.pronunciation === null
  ) {
    return null;
  }

  const entries = [
    {
      key: 'gv',
      criterionName: 'Grammar & Vocabulary',
      averageScore: avgs.grammarVocabulary,
      tips: [
        'Practice answering everyday B1 topics using past simple, present perfect, and future forms ("going to" / "will").',
        'Before recording, write down 3 topic-specific words or phrases to include naturally in your answer.',
        'Listen back to your recording and notice verb tenses and singular/plural endings.',
      ],
    },
    {
      key: 'dm',
      criterionName: 'Discourse Management',
      averageScore: avgs.discourseManagement,
      tips: [
        'Structure each answer in 3 parts: direct answer -> one personal example -> short concluding thought.',
        'Use natural B1 linking phrases such as "first of all", "for example", "because of that", and "in addition".',
        'Aim to develop one clear idea with specific details rather than repeating the same point.',
      ],
    },
    {
      key: 'pr',
      criterionName: 'Pronunciation',
      averageScore: avgs.pronunciation,
      tips: [
        'Speak at a steady, calm pace and remember to pronounce final consonant sounds like -s, -ed, and -t.',
        'Stress the key content words (nouns, main verbs, adjectives) in each sentence.',
        'Pause briefly between ideas instead of rushing through long sentences.',
      ],
    },
  ];

  entries.sort((a, b) => a.averageScore - b.averageScore);
  return entries[0];
}

export function buildRosterAndUserDirectory(
  roster: StudentRosterEntry[],
  users: UserProfile[]
): Array<{
  key: string;
  uid: string;
  studentId: string;
  fullName: string;
  email: string;
  className: string;
  accountStatus: 'active' | 'inactive';
}> {
  const map = new Map<
    string,
    {
      key: string;
      uid: string;
      studentId: string;
      fullName: string;
      email: string;
      className: string;
      accountStatus: 'active' | 'inactive';
    }
  >();

  for (const r of roster) {
    const emailKey = r.email.toLowerCase();
    map.set(emailKey, {
      key: r.linkedUid || emailKey,
      uid: r.linkedUid || '',
      studentId: r.studentId,
      fullName: r.fullName,
      email: emailKey,
      className: r.className,
      accountStatus: r.accountStatus,
    });
  }

  for (const u of users) {
    if (u.role !== 'student') continue;
    const emailKey = u.email.toLowerCase();
    const existing = map.get(emailKey);
    if (existing) {
      map.set(emailKey, {
        ...existing,
        key: u.userId,
        uid: u.userId,
        studentId: u.studentId || existing.studentId,
        fullName: u.fullName || existing.fullName,
        className: u.className || existing.className,
      });
    } else {
      map.set(emailKey, {
        key: u.userId,
        uid: u.userId,
        studentId: u.studentId || '—',
        fullName: u.fullName,
        email: emailKey,
        className: u.className || 'Unassigned',
        accountStatus: u.accountStatus,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );
}

export function buildWeeklyStudentSummaries(params: {
  assignment: Assignment;
  students: ReturnType<typeof buildRosterAndUserDirectory>;
  submissions: Submission[];
}): WeeklyStudentSummary[] {
  const weekSubs = params.submissions.filter(
    (s) => s.assignmentId === params.assignment.assignmentId
  );

  // Also include any submitting user not yet in the directory
  const directory = [...params.students];
  const seenUids = new Set(directory.map((s) => s.uid).filter(Boolean));
  const seenEmails = new Set(directory.map((s) => s.email.toLowerCase()));

  for (const sub of weekSubs) {
    if (!seenUids.has(sub.studentUid) && !seenEmails.has(sub.studentEmail.toLowerCase())) {
      seenUids.add(sub.studentUid);
      seenEmails.add(sub.studentEmail.toLowerCase());
      directory.push({
        key: sub.studentUid,
        uid: sub.studentUid,
        studentId: sub.studentId || '—',
        fullName: sub.studentName,
        email: sub.studentEmail.toLowerCase(),
        className: sub.className || 'General B1',
        accountStatus: 'active',
      });
    }
  }

  return directory.map((student) => {
    const stuSubs = weekSubs.filter(
      (s) =>
        (student.uid && s.studentUid === student.uid) ||
        s.studentEmail.toLowerCase() === student.email.toLowerCase()
    );

    const totalQuestions = params.assignment.questions.length;
    const completedQuestions = stuSubs.filter(
      (s) => s.processingStatus === 'feedback_available' || s.processingStatus === 'processing'
    ).length;

    let status: WeeklyStudentSummary['status'] = 'Not Started';
    if (stuSubs.length > 0) {
      if (stuSubs.some((s) => s.processingStatus === 'processing')) {
        status = 'Processing';
      } else if (
        stuSubs.some((s) => s.processingStatus === 'feedback_available') &&
        completedQuestions >= totalQuestions
      ) {
        status = 'Feedback Available';
      } else if (stuSubs.some((s) => s.processingStatus === 'feedback_available')) {
        status = 'In Progress';
      } else if (stuSubs.some((s) => s.processingStatus === 'needs_rerecording')) {
        status = 'Needs Re-recording';
      } else if (stuSubs.some((s) => s.processingStatus === 'failed')) {
        status = 'Failed';
      } else {
        status = 'In Progress';
      }
    }

    const avgInfo = calculateAssignmentAverageForSubmissions(stuSubs);
    const dates = stuSubs
      .map((s) => toJsDate(s.submittedAt))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    return {
      studentKey: student.key,
      studentUid: student.uid,
      studentId: student.studentId || '—',
      studentName: student.fullName,
      studentEmail: student.email,
      className: student.className || 'Unassigned',
      completedQuestions,
      totalQuestions,
      status,
      averageScore: avgInfo.average,
      latestSubmittedAt: dates[0] || null,
      submissions: stuSubs,
    };
  });
}
