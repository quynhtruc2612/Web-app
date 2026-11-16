import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertCircle,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Mic,
  RefreshCw,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  prepareOrUploadAudioToStorage,
  resolveSubmissionAudioUrl,
  writeAudioChunksToFirestore,
} from '../../lib/audioStorage';
import {
  buildSubmissionId,
  createOrReplaceProcessingSubmission,
  endStudentSession,
  getStoredStudentSessionToken,
  initializeStudentProgressCollection,
  markSubmissionProcessingStatus,
  recalculateAndSyncStudentProgress,
  refreshStudentSessionToken,
  saveSubmissionAssessmentResult,
} from '../../lib/db';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  calculateAssignmentAverageForSubmissions,
  computeCriterionAverages,
  formatDateShort,
  formatDateTime,
  identifyWeakestCriterion,
} from '../../lib/stats';
import type {
  AssessmentApiResponse,
  Assignment,
  SpeakingQuestion,
  Submission,
  UserProfile,
} from '../../types';
import { AssessmentFeedbackView } from '../AssessmentFeedbackView';
import { AudioRecorder } from '../AudioRecorder';

type StudentTab = 'dashboard' | 'practice' | 'results' | 'history' | 'settings';

interface StudentDashboardProps {
  profile: UserProfile;
  onSessionExpired?: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  profile,
  onSessionExpired,
}) => {
  const [activeTab, setActiveTab] = useState<StudentTab>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [exitingSession, setExitingSession] = useState(false);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(
    null
  );
  const [retryingSubmissionId, setRetryingSubmissionId] = useState<string | null>(
    null
  );
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  const [bannerNotice, setBannerNotice] = useState<{
    message: string;
    tone: 'success' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    initializeStudentProgressCollection(profile).catch((err) => {
      console.warn('Could not initialize studentProgress doc:', err);
    });
  }, [profile.userId]);

  useEffect(() => {
    // Firestore rule enforces status != 'draft' for students
    const qAssignments = query(
      collection(db, 'assignments'),
      where('status', 'in', ['open', 'locked'])
    );
    const unsub = onSnapshot(
      qAssignments,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Assignment)
          .sort((a, b) => b.weekNumber - a.weekNumber);
        setAssignments(list);
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'assignments')
    );

    return () => unsub();
  }, [profile.userId]);

  // Deterministic per-question document subscriptions (supports cross-session history via allow get without exposing list queries)
  useEffect(() => {
    const subIds: string[] = [];
    for (const assignment of assignments) {
      for (const q of assignment.questions) {
        subIds.push(
          buildSubmissionId(assignment.assignmentId, q.questionId, profile.userId)
        );
      }
    }

    if (subIds.length === 0) {
      setSubmissions([]);
      return;
    }

    const byId = new Map<string, Submission>();
    const syncState = () => {
      const sorted = Array.from(byId.values()).sort((a, b) => {
        const ta = a.submittedAt?.seconds || 0;
        const tb = b.submittedAt?.seconds || 0;
        return tb - ta;
      });
      setSubmissions(sorted);
    };

    const unsubs = subIds.map((subId) =>
      onSnapshot(
        doc(db, 'submissions', subId),
        (snap) => {
          if (snap.exists()) {
            byId.set(subId, snap.data() as Submission);
          } else {
            byId.delete(subId);
          }
          syncState();
        },
        (err) => {
          if (
            profile.sessionExpiresAt &&
            Date.now() >= profile.sessionExpiresAt
          ) {
            endStudentSession().finally(() => onSessionExpired?.());
            return;
          }
          handleFirestoreError(err, OperationType.GET, `submissions/${subId}`);
        }
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [assignments, profile.userId, profile.sessionExpiresAt, onSessionExpired]);

  const openAssignment = useMemo(
    () => assignments.find((a) => a.status === 'open') || null,
    [assignments]
  );

  useEffect(() => {
    if (!selectedAssignmentId && assignments.length > 0) {
      setSelectedAssignmentId(
        openAssignment?.assignmentId || assignments[0].assignmentId
      );
    }
  }, [assignments, openAssignment, selectedAssignmentId]);

  const currentPracticeAssignment = useMemo(
    () =>
      assignments.find((a) => a.assignmentId === selectedAssignmentId) ||
      openAssignment ||
      assignments[0] ||
      null,
    [assignments, selectedAssignmentId, openAssignment]
  );

  const previousAssignments = useMemo(
    () =>
      assignments.filter(
        (a) => a.assignmentId !== openAssignment?.assignmentId
      ),
    [assignments, openAssignment]
  );

  const assessedSubmissions = useMemo(
    () =>
      submissions.filter(
        (s) => s.processingStatus === 'feedback_available' && s.assessment !== null
      ),
    [submissions]
  );

  const criterionAverages = useMemo(
    () => computeCriterionAverages(submissions),
    [submissions]
  );

  const weakestCriterion = useMemo(
    () => identifyWeakestCriterion(submissions),
    [submissions]
  );

  const completedAssignmentCount = useMemo(() => {
    let count = 0;
    for (const week of assignments) {
      const weekSubs = submissions.filter(
        (s) =>
          s.assignmentId === week.assignmentId &&
          s.processingStatus === 'feedback_available'
      );
      if (week.questions.length > 0 && weekSubs.length >= week.questions.length) {
        count++;
      }
    }
    return count;
  }, [assignments, submissions]);

  const weeklyTrendData = useMemo(() => {
    const asc = [...assignments].sort((a, b) => a.weekNumber - b.weekNumber);
    return asc
      .map((week) => {
        const weekSubs = submissions.filter(
          (s) => s.assignmentId === week.assignmentId
        );
        const avgs = computeCriterionAverages(weekSubs);
        if (avgs.assessedCount === 0) return null;
        return {
          weekLabel: `Week ${String(week.weekNumber).padStart(2, '0')}`,
          overall: avgs.overall,
          grammar: avgs.grammarVocabulary,
          discourse: avgs.discourseManagement,
          pronunciation: avgs.pronunciation,
        };
      })
      .filter(Boolean);
  }, [assignments, submissions]);

  const callAssessEndpoint = async (params: {
    blob: Blob;
    mimeType: string;
    questionPrompt: string;
    weekTitle: string;
    speakingTopic: string;
    recordingDuration: number;
  }): Promise<AssessmentApiResponse> => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Your speaking session has ended. Please re-enter your details.');
    }
    const idToken = await user.getIdToken();
    let sessionToken =
      getStoredStudentSessionToken() || (await refreshStudentSessionToken());

    const buildFormData = () => {
      const formData = new FormData();
      formData.append('audio', params.blob, 'speaking-answer.webm');
      formData.append('questionPrompt', params.questionPrompt);
      formData.append('weekTitle', params.weekTitle);
      formData.append('speakingTopic', params.speakingTopic);
      formData.append('recordingDuration', String(params.recordingDuration));
      formData.append('mimeType', params.mimeType);
      return formData;
    };

    let response = await fetch('/api/assess', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'X-Student-Session': sessionToken,
      },
      body: buildFormData(),
    });

    if (response.status === 401) {
      try {
        sessionToken = await refreshStudentSessionToken();
        response = await fetch('/api/assess', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'X-Student-Session': sessionToken,
          },
          body: buildFormData(),
        });
      } catch {
        // Let original error response surface below
      }
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'AI assessment request failed.');
    }
    return data as AssessmentApiResponse;
  };

  const handleSubmitRecording = async (
    assignment: Assignment,
    question: SpeakingQuestion,
    existingSubmission: Submission | undefined,
    payload: { blob: Blob; mimeType: string; durationSeconds: number }
  ) => {
    if (submittingQuestionId) return;
    if (assignment.status !== 'open') {
      setBannerNotice({
        message: 'This assignment is locked and cannot accept new submissions.',
        tone: 'error',
      });
      return;
    }

    const submissionId = buildSubmissionId(
      assignment.assignmentId,
      question.questionId,
      profile.userId
    );
    const isResubmission = Boolean(existingSubmission);

    setSubmittingQuestionId(question.questionId);
    setBannerNotice({
      message: 'Uploading recording and running AI speaking assessment...',
      tone: 'info',
    });

    try {
      const storagePrep = await prepareOrUploadAudioToStorage({
        blob: payload.blob,
        mimeType: payload.mimeType,
        studentUid: profile.userId,
        assignmentId: assignment.assignmentId,
        questionId: question.questionId,
        submissionId,
      });

      await createOrReplaceProcessingSubmission({
        submissionId,
        isResubmission,
        student: profile,
        assignment,
        question,
        audioStorageType: storagePrep.audioStorageType,
        audioStoragePath: storagePrep.audioStoragePath,
        audioMimeType: payload.mimeType,
        audioChunkCount: storagePrep.audioChunkCount,
        recordingDuration: payload.durationSeconds,
      });

      if (
        storagePrep.audioStorageType === 'firestore_chunks' &&
        storagePrep.base64Chunks.length > 0
      ) {
        await writeAudioChunksToFirestore({
          submissionId,
          studentUid: profile.userId,
          chunks: storagePrep.base64Chunks,
        });
      }

      try {
        const aiResult = await callAssessEndpoint({
          blob: payload.blob,
          mimeType: payload.mimeType,
          questionPrompt: question.prompt,
          weekTitle: assignment.title,
          speakingTopic: assignment.topic,
          recordingDuration: payload.durationSeconds,
        });

        await saveSubmissionAssessmentResult(submissionId, aiResult);
        recalculateAndSyncStudentProgress(profile, assignments).catch((err) => {
          console.warn('Progress sync warning:', err);
        });

        setExpandedQuestionId(question.questionId);
        if (aiResult.assessment_status === 'needs_rerecording') {
          setBannerNotice({
            message:
              'Your recording was saved, but the audio was too quiet or unclear. Please record again.',
            tone: 'error',
          });
        } else {
          setBannerNotice({
            message: `Feedback is ready for Question ${question.order}! Overall score: ${aiResult.overallScore?.toFixed(1)}/5.`,
            tone: 'success',
          });
        }
      } catch (aiErr: any) {
        await markSubmissionProcessingStatus(
          submissionId,
          'failed',
          aiErr?.message || 'AI assessment failed.'
        );
        setExpandedQuestionId(question.questionId);
        setBannerNotice({
          message:
            'Your recording was saved safely, but AI assessment could not finish. Click "Retry AI Assessment" below.',
          tone: 'error',
        });
      }
    } catch (uploadErr: any) {
      setBannerNotice({
        message:
          uploadErr?.message ||
          'Upload failed. Please check your internet connection and try submitting again.',
        tone: 'error',
      });
    } finally {
      setSubmittingQuestionId(null);
    }
  };

  const handleRetryAssessment = async (submission: Submission) => {
    if (retryingSubmissionId) return;
    setRetryingSubmissionId(submission.submissionId);
    setBannerNotice({
      message: 'Retrying AI assessment using your saved recording...',
      tone: 'info',
    });

    try {
      await markSubmissionProcessingStatus(submission.submissionId, 'processing', '');
      const audioRes = await resolveSubmissionAudioUrl(submission);
      const fetched = await fetch(audioRes.url);
      const blob = await fetched.blob();
      if (audioRes.shouldRevoke) {
        URL.revokeObjectURL(audioRes.url);
      }

      const aiResult = await callAssessEndpoint({
        blob,
        mimeType: submission.audioMimeType || blob.type || 'audio/webm',
        questionPrompt: submission.questionPromptSnapshot,
        weekTitle: submission.assignmentTitle,
        speakingTopic:
          assignments.find((a) => a.assignmentId === submission.assignmentId)
            ?.topic || 'Speaking Practice',
        recordingDuration: submission.recordingDuration,
      });

      await saveSubmissionAssessmentResult(submission.submissionId, aiResult);
      recalculateAndSyncStudentProgress(profile, assignments).catch((err) => {
        console.warn('Progress sync warning:', err);
      });
      setBannerNotice({
        message: 'AI assessment completed and feedback is now available!',
        tone: 'success',
      });
    } catch (err: any) {
      await markSubmissionProcessingStatus(
        submission.submissionId,
        'failed',
        err?.message || 'Retry failed.'
      );
      setBannerNotice({
        message: err?.message || 'Retry failed. Please try again shortly.',
        tone: 'error',
      });
    } finally {
      setRetryingSubmissionId(null);
    }
  };

  const handleExitSession = async () => {
    if (exitingSession) return;
    setExitingSession(true);
    try {
      await endStudentSession();
    } finally {
      setExitingSession(false);
    }
  };

  if (profile.accountStatus === 'inactive') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">
            Student Record Deactivated
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Your student record ({profile.studentId}) is currently inactive. Please contact your teacher to reactivate access.
          </p>
          <button
            type="button"
            onClick={handleExitSession}
            disabled={exitingSession}
            className="mt-6 inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            Exit Session
          </button>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: StudentTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      id: 'practice',
      label: 'Weekly Speaking Practice',
      icon: <Mic className="h-4 w-4" />,
    },
    {
      id: 'results',
      label: 'My Results',
      icon: <Award className="h-4 w-4" />,
    },
    {
      id: 'history',
      label: 'Practice History',
      icon: <History className="h-4 w-4" />,
    },
    {
      id: 'settings',
      label: 'Account Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  const pageTitleMap: Record<StudentTab, string> = {
    dashboard: 'Student Dashboard',
    practice: 'Weekly Speaking Practice',
    results: 'My Results',
    history: 'Practice History & Progress',
    settings: 'Account Settings',
  };

  const activeResultSubmission =
    assessedSubmissions.find((s) => s.submissionId === selectedResultId) ||
    assessedSubmissions[0] ||
    null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            B1 Speaking Practice
          </span>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileNavOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3">
            <p className="truncate text-sm font-semibold text-slate-900">
              {profile.fullName}
            </p>
            <p className="truncate text-xs text-slate-500">
              {profile.studentId || 'Student'} · {profile.className || 'B1 Learner'}
            </p>
            {profile.sessionExpiresAt && (
              <p className="mt-1 text-[11px] text-emerald-700">
                Verified session · Until{' '}
                {new Date(profile.sessionExpiresAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleExitSession}
            disabled={exitingSession}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            {exitingSession ? 'Exiting...' : 'Exit Session'}
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
                {pageTitleMap[activeTab]}
              </h1>
            </div>

            <div className="flex items-center gap-2.5">
              {openAssignment && activeTab !== 'practice' && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAssignmentId(openAssignment.assignmentId);
                    setActiveTab('practice');
                  }}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <Mic className="h-4 w-4" />
                  Practice Week {String(openAssignment.weekNumber).padStart(2, '0')}
                </button>
              )}
              <button
                type="button"
                onClick={handleExitSession}
                disabled={exitingSession}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Exit Session</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
          {bannerNotice && (
            <div
              role="status"
              className={`mb-6 flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium ${
                bannerNotice.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : bannerNotice.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-blue-200 bg-blue-50 text-blue-900'
              }`}
            >
              <span>{bannerNotice.message}</span>
              <button
                type="button"
                onClick={() => setBannerNotice(null)}
                className="ml-4 text-xs underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              <div className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />
              <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
            </div>
          ) : (
            <>
              {/* 1. STUDENT DASHBOARD */}
              {activeTab === 'dashboard' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">
                      Welcome back, {profile.fullName.split(' ')[0]}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {profile.className
                        ? `${profile.className} · Ready for this week's speaking practice`
                        : 'Practice speaking every week and review your AI feedback.'}
                    </p>
                  </div>

                  {/* Prominent Active Weekly Assignment Card */}
                  {openAssignment ? (
                    (() => {
                      const weekSubs = submissions.filter(
                        (s) => s.assignmentId === openAssignment.assignmentId
                      );
                      const completedCount = weekSubs.filter(
                        (s) =>
                          s.processingStatus === 'feedback_available' ||
                          s.processingStatus === 'processing'
                      ).length;
                      const totalCount = openAssignment.questions.length;
                      const pct =
                        totalCount > 0
                          ? Math.round((completedCount / totalCount) * 100)
                          : 0;

                      return (
                        <div className="rounded-xl border border-blue-200 bg-white p-6 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-blue-700">
                                Current Active Assignment · Week{' '}
                                {String(openAssignment.weekNumber).padStart(2, '0')}
                                {openAssignment.deadline
                                  ? ` · Deadline: ${openAssignment.deadline}`
                                  : ''}
                              </p>
                              <h3 className="text-2xl font-bold text-slate-900">
                                {openAssignment.title}
                              </h3>
                              <p className="text-sm font-medium text-slate-700">
                                Speaking Topic: {openAssignment.topic}
                              </p>
                              {openAssignment.instructions && (
                                <p className="max-w-2xl pt-1 text-sm text-slate-600">
                                  {openAssignment.instructions}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAssignmentId(
                                  openAssignment.assignmentId
                                );
                                setActiveTab('practice');
                              }}
                              className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
                            >
                              <Mic className="h-4 w-4" />
                              Start Speaking Practice
                            </button>
                          </div>

                          <div className="mt-6 border-t border-slate-100 pt-4">
                            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                              <span>
                                Your Completion Progress ({completedCount} of{' '}
                                {totalCount} questions)
                              </span>
                              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                {pct}%
                              </span>
                            </div>
                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-blue-700 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="grid items-center gap-6 rounded-xl border border-slate-200 bg-white p-6 md:grid-cols-12">
                      <div className="md:col-span-7">
                        <h3 className="text-lg font-bold text-slate-900">
                          No Active Weekly Assignment Right Now
                        </h3>
                        <p className="mt-1.5 text-sm text-slate-600">
                          Your teacher has not opened a new week yet. You can still review your previous feedback and practice history below.
                        </p>
                      </div>
                      <div className="overflow-hidden rounded-lg border border-slate-100 md:col-span-5">
                        <img
                          src="/src/assets/images/empty_speaking_desk_1794839013474.jpg"
                          alt="Study desk with headphones and notebook"
                          referrerPolicy="no-referrer"
                          className="h-40 w-full object-cover"
                        />
                      </div>
                    </div>
                  )}

                  {/* Recent Results + Previous Weeks */}
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-900">
                          Recent Assessment Results
                        </h3>
                        <button
                          type="button"
                          onClick={() => setActiveTab('results')}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          See All Results
                        </button>
                      </div>

                      {assessedSubmissions.length === 0 ? (
                        <p className="mt-6 text-sm text-slate-500">
                          Complete a speaking question to receive your first AI assessment.
                        </p>
                      ) : (
                        <div className="mt-4 divide-y divide-slate-100">
                          {assessedSubmissions.slice(0, 4).map((sub) => (
                            <div
                              key={sub.submissionId}
                              className="flex items-center justify-between gap-4 py-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">
                                  {sub.questionPromptSnapshot}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Week {String(sub.weekNumber).padStart(2, '0')} ·{' '}
                                  {formatDateShort(sub.assessedAt || sub.submittedAt)}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="font-mono text-base font-bold text-blue-700 tabular-nums">
                                  {sub.overallScore?.toFixed(1)}/5
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedResultId(sub.submissionId);
                                    setActiveTab('results');
                                  }}
                                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  View
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-900">
                          Previous Weekly Assignments
                        </h3>
                        <button
                          type="button"
                          onClick={() => setActiveTab('history')}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          Practice History
                        </button>
                      </div>

                      {previousAssignments.length === 0 ? (
                        <p className="mt-6 text-sm text-slate-500">
                          Previous locked weeks will appear here for review.
                        </p>
                      ) : (
                        <div className="mt-4 divide-y divide-slate-100">
                          {previousAssignments.slice(0, 4).map((week) => {
                            const wSubs = submissions.filter(
                              (s) => s.assignmentId === week.assignmentId
                            );
                            const avg =
                              calculateAssignmentAverageForSubmissions(wSubs);
                            return (
                              <div
                                key={week.assignmentId}
                                className="flex items-center justify-between gap-4 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">
                                    Week {String(week.weekNumber).padStart(2, '0')} ·{' '}
                                    {week.title}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {week.status === 'locked'
                                      ? 'Locked (Read-only)'
                                      : 'Open'}{' '}
                                    · {avg.assessedCount}/{week.questions.length}{' '}
                                    assessed
                                  </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="font-mono text-sm font-semibold text-slate-700 tabular-nums">
                                    {avg.average !== null
                                      ? `${avg.average.toFixed(1)}/5`
                                      : '—'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedAssignmentId(week.assignmentId);
                                      setActiveTab('practice');
                                    }}
                                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Open
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 2. WEEKLY SPEAKING PRACTICE */}
              {activeTab === 'practice' && (
                <div className="space-y-6">
                  {assignments.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                      No speaking assignments have been published by your teacher yet.
                    </div>
                  ) : (
                    currentPracticeAssignment && (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="font-mono font-semibold text-slate-700">
                                Week{' '}
                                {String(
                                  currentPracticeAssignment.weekNumber
                                ).padStart(2, '0')}
                              </span>
                              <span>·</span>
                              <span
                                className={`font-semibold ${
                                  currentPracticeAssignment.status === 'open'
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'
                                }`}
                              >
                                {currentPracticeAssignment.status === 'open'
                                  ? 'Open for Submissions'
                                  : 'Locked (Read-Only)'}
                              </span>
                              {currentPracticeAssignment.deadline && (
                                <>
                                  <span>·</span>
                                  <span>
                                    Deadline: {currentPracticeAssignment.deadline}
                                  </span>
                                </>
                              )}
                            </div>
                            <h2 className="text-xl font-bold text-slate-900">
                              {currentPracticeAssignment.title}
                            </h2>
                            <p className="text-sm font-medium text-slate-700">
                              Topic: {currentPracticeAssignment.topic}
                            </p>
                            {currentPracticeAssignment.instructions && (
                              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                {currentPracticeAssignment.instructions}
                              </p>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500">
                              Select Week
                            </label>
                            <select
                              value={currentPracticeAssignment.assignmentId}
                              onChange={(e) => {
                                setSelectedAssignmentId(e.target.value);
                                setExpandedQuestionId(null);
                              }}
                              className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                            >
                              {assignments.map((a) => (
                                <option key={a.assignmentId} value={a.assignmentId}>
                                  Week {String(a.weekNumber).padStart(2, '0')} —{' '}
                                  {a.title} ({a.status})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Individual Question Cards */}
                        <div className="space-y-5">
                          {currentPracticeAssignment.questions.map((q, idx) => {
                            const sub = submissions.find(
                              (s) =>
                                s.assignmentId ===
                                  currentPracticeAssignment.assignmentId &&
                                s.questionId === q.questionId
                            );
                            const isOpenWeek =
                              currentPracticeAssignment.status === 'open';
                            const canRecord =
                              isOpenWeek &&
                              (!sub ||
                                sub.resubmissionAllowed ||
                                sub.processingStatus === 'needs_rerecording');
                            const isFeedbackExpanded =
                              expandedQuestionId === q.questionId;

                            return (
                              <div
                                key={q.questionId}
                                className="rounded-xl border border-slate-200 bg-white p-6"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                  <div className="space-y-1.5">
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                      <span className="font-mono font-semibold text-slate-500">
                                        Question {idx + 1} of{' '}
                                        {currentPracticeAssignment.questions.length}
                                      </span>
                                      <span>·</span>
                                      {!sub ? (
                                        <span className="font-semibold text-slate-500">
                                          Not Recorded Yet
                                        </span>
                                      ) : sub.processingStatus ===
                                        'feedback_available' ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                          Feedback Available (
                                          {sub.overallScore?.toFixed(1)}/5)
                                        </span>
                                      ) : sub.processingStatus === 'processing' ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                                          <Clock className="h-3.5 w-3.5" />
                                          Processing AI Assessment...
                                        </span>
                                      ) : sub.processingStatus ===
                                        'needs_rerecording' ? (
                                        <span className="font-semibold text-amber-700">
                                          Needs Re-recording
                                        </span>
                                      ) : (
                                        <span className="font-semibold text-red-700">
                                          AI Assessment Failed (Recording Saved)
                                        </span>
                                      )}
                                      {sub?.resubmissionAllowed && isOpenWeek && (
                                        <>
                                          <span>·</span>
                                          <span className="font-semibold text-blue-700">
                                            Resubmission Permitted by Teacher
                                          </span>
                                        </>
                                      )}
                                    </div>

                                    <h3 className="text-lg font-semibold text-slate-900">
                                      {sub?.questionPromptSnapshot || q.prompt}
                                    </h3>

                                    {q.tips && (
                                      <p className="text-xs text-slate-500">
                                        Tip: {q.tips}
                                      </p>
                                    )}
                                  </div>

                                  {sub && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedQuestionId(
                                          isFeedbackExpanded ? null : q.questionId
                                        )
                                      }
                                      className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                                    >
                                      {isFeedbackExpanded
                                        ? 'Hide Feedback'
                                        : sub.processingStatus ===
                                          'feedback_available'
                                        ? 'View Feedback'
                                        : 'View Status'}
                                    </button>
                                  )}
                                </div>

                                {sub && isFeedbackExpanded && (
                                  <div className="mt-5 border-t border-slate-100 pt-5">
                                    <AssessmentFeedbackView
                                      submission={sub}
                                      retrying={
                                        retryingSubmissionId === sub.submissionId
                                      }
                                      onRetryAssessment={() =>
                                        handleRetryAssessment(sub)
                                      }
                                    />
                                  </div>
                                )}

                                {sub &&
                                  !isFeedbackExpanded &&
                                  sub.processingStatus === 'failed' && (
                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-900">
                                      <span>
                                        Your audio was saved, but AI processing failed. Click Retry to assess it now.
                                      </span>
                                      <button
                                        type="button"
                                        disabled={
                                          retryingSubmissionId === sub.submissionId
                                        }
                                        onClick={() => handleRetryAssessment(sub)}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        Retry AI Assessment
                                      </button>
                                    </div>
                                  )}

                                {canRecord ? (
                                  <div className="mt-5">
                                    <AudioRecorder
                                      isSubmitting={
                                        submittingQuestionId === q.questionId
                                      }
                                      onSubmitRecording={(payload) =>
                                        handleSubmitRecording(
                                          currentPracticeAssignment,
                                          q,
                                          sub,
                                          payload
                                        )
                                      }
                                    />
                                  </div>
                                ) : !isOpenWeek && !sub ? (
                                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                                    <Lock className="h-4 w-4 text-slate-400" />
                                    <span>
                                      This week is locked. You did not submit an answer for this question.
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )
                  )}
                </div>
              )}

              {/* 3. MY RESULTS */}
              {activeTab === 'results' && (
                <div className="space-y-6">
                  {assessedSubmissions.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                      <BookOpen className="mx-auto h-8 w-8 text-slate-400" />
                      <h2 className="mt-3 text-base font-semibold text-slate-900">
                        No Assessment Results Yet
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Submit a speaking answer in Weekly Speaking Practice to receive detailed feedback across all three B1 criteria.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-12">
                      <div className="space-y-2 lg:col-span-4">
                        <h2 className="text-sm font-semibold text-slate-700">
                          Assessed Answers ({assessedSubmissions.length})
                        </h2>
                        <div className="space-y-2">
                          {assessedSubmissions.map((sub) => {
                            const selected =
                              activeResultSubmission?.submissionId ===
                              sub.submissionId;
                            return (
                              <button
                                key={sub.submissionId}
                                type="button"
                                onClick={() =>
                                  setSelectedResultId(sub.submissionId)
                                }
                                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                                  selected
                                    ? 'border-blue-600 bg-blue-50/50'
                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                                  <span>
                                    Week {String(sub.weekNumber).padStart(2, '0')}
                                  </span>
                                  <span className="font-mono font-bold text-blue-700 tabular-nums">
                                    {sub.overallScore?.toFixed(1)}/5
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">
                                  {sub.questionPromptSnapshot}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {formatDateTime(sub.assessedAt || sub.submittedAt)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="lg:col-span-8">
                        {activeResultSubmission && (
                          <div className="space-y-4">
                            <div className="rounded-xl border border-slate-200 bg-white p-5">
                              <p className="text-xs font-medium text-slate-500">
                                Week {String(activeResultSubmission.weekNumber).padStart(2, '0')} ·{' '}
                                {activeResultSubmission.assignmentTitle}
                              </p>
                              <h2 className="mt-1 text-lg font-bold text-slate-900">
                                {activeResultSubmission.questionPromptSnapshot}
                              </h2>
                            </div>
                            <AssessmentFeedbackView
                              submission={activeResultSubmission}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 4. PRACTICE HISTORY & PROGRESS */}
              {activeTab === 'history' && (
                <div className="space-y-6">
                  {/* Progress KPIs */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Completed Weeks
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                        {completedAssignmentCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Submitted Answers
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                        {submissions.length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Grammar & Vocab Avg
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                        {criterionAverages.grammarVocabulary !== null
                          ? `${criterionAverages.grammarVocabulary.toFixed(1)}/5`
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Discourse Avg
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-amber-700 tabular-nums">
                        {criterionAverages.discourseManagement !== null
                          ? `${criterionAverages.discourseManagement.toFixed(1)}/5`
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Pronunciation Avg
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                        {criterionAverages.pronunciation !== null
                          ? `${criterionAverages.pronunciation.toFixed(1)}/5`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Chart + My Improvement Goals */}
                  <div className="grid gap-6 lg:grid-cols-12">
                    <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-blue-700" />
                        <h2 className="text-base font-semibold text-slate-900">
                          My Score Trends Across Weeks
                        </h2>
                      </div>
                      {weeklyTrendData.length === 0 ? (
                        <div className="flex h-56 items-center justify-center text-sm text-slate-500">
                          Your score chart will appear once your submissions are assessed.
                        </div>
                      ) : (
                        <div className="mt-4 h-56 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={weeklyTrendData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="weekLabel" tick={{ fontSize: 12 }} />
                              <YAxis
                                domain={[0, 5]}
                                ticks={[0, 1, 2, 3, 4, 5]}
                                tick={{ fontSize: 12 }}
                              />
                              <Tooltip />
                              <Line
                                type="monotone"
                                dataKey="overall"
                                name="Overall"
                                stroke="#1d4ed8"
                                strokeWidth={2.5}
                              />
                              <Line
                                type="monotone"
                                dataKey="grammar"
                                name="Grammar & Vocab"
                                stroke="#059669"
                                strokeWidth={1.75}
                              />
                              <Line
                                type="monotone"
                                dataKey="discourse"
                                name="Discourse"
                                stroke="#d97706"
                                strokeWidth={1.75}
                              />
                              <Line
                                type="monotone"
                                dataKey="pronunciation"
                                name="Pronunciation"
                                stroke="#6366f1"
                                strokeWidth={1.75}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-blue-700" />
                        <h2 className="text-base font-semibold text-slate-900">
                          My Improvement Goals
                        </h2>
                      </div>
                      {weakestCriterion ? (
                        <div className="mt-4 space-y-3">
                          <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-100">
                            <p className="text-xs text-slate-500">
                              Priority Focus Criterion
                            </p>
                            <div className="mt-1 flex items-baseline justify-between">
                              <p className="text-base font-bold text-slate-900">
                                {weakestCriterion.criterionName}
                              </p>
                              <span className="font-mono text-sm font-bold text-amber-700 tabular-nums">
                                Avg {weakestCriterion.averageScore.toFixed(1)}/5
                              </span>
                            </div>
                          </div>
                          <ul className="space-y-2 text-sm text-slate-700">
                            {weakestCriterion.tips.map((tip, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700" />
                                <span>{tip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-slate-500">
                          Complete at least one assessed speaking question so we can identify your priority B1 improvement focus.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* All Weekly Assignments Archive */}
                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <h2 className="text-base font-semibold text-slate-900">
                      All Weekly Assignments
                    </h2>
                    <div className="mt-4 divide-y divide-slate-100">
                      {assignments.length === 0 ? (
                        <p className="py-6 text-sm text-slate-500">
                          No weekly assignments available yet.
                        </p>
                      ) : (
                        assignments.map((week) => {
                          const wSubs = submissions.filter(
                            (s) => s.assignmentId === week.assignmentId
                          );
                          const avgInfo =
                            calculateAssignmentAverageForSubmissions(wSubs);
                          return (
                            <div
                              key={week.assignmentId}
                              className="flex flex-wrap items-center justify-between gap-4 py-4"
                            >
                              <div>
                                <p className="text-xs text-slate-500">
                                  Week {String(week.weekNumber).padStart(2, '0')} ·{' '}
                                  {week.status === 'open'
                                    ? 'Open'
                                    : 'Locked (Read-only)'}{' '}
                                  · {avgInfo.assessedCount}/
                                  {week.questions.length} questions assessed
                                </p>
                                <p className="mt-0.5 text-base font-semibold text-slate-900">
                                  {week.title}
                                </p>
                                <p className="text-xs text-slate-600">
                                  Topic: {week.topic}
                                </p>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-xs text-slate-500">
                                    Week Average
                                  </p>
                                  <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
                                    {avgInfo.average !== null
                                      ? `${avgInfo.average.toFixed(1)}/5`
                                      : avgInfo.hasPending
                                      ? 'Processing'
                                      : '—'}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedAssignmentId(week.assignmentId);
                                    setActiveTab('practice');
                                  }}
                                  className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                >
                                  {week.status === 'open'
                                    ? 'Practice'
                                    : 'Review Week'}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 5. ACCOUNT SETTINGS */}
              {activeTab === 'settings' && (
                <div className="max-w-xl space-y-6">
                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          Verified Student Session
                        </h2>
                        <p className="text-xs text-slate-500">
                          Matched against your teacher&apos;s student list
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <ShieldCheck className="h-4 w-4" />
                        Active
                      </span>
                    </div>

                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between border-b border-slate-100 pb-2.5">
                        <dt className="text-slate-500">Full Name</dt>
                        <dd className="font-semibold text-slate-900">
                          {profile.fullName}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2.5">
                        <dt className="text-slate-500">Student ID</dt>
                        <dd className="font-mono font-semibold text-slate-900">
                          {profile.studentId}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2.5">
                        <dt className="text-slate-500">Class</dt>
                        <dd className="font-medium text-slate-900">
                          {profile.className}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Session Expires</dt>
                        <dd className="text-slate-700">
                          {profile.sessionExpiresAt
                            ? new Date(profile.sessionExpiresAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '4 hours from sign-in'}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                      To prevent impersonation, Student ID and Class details are managed by your teacher and cannot be edited here. If you notice a mistake, ask your teacher to update the class roster.
                    </p>

                    <div className="mt-5 flex justify-end">
                      <button
                        type="button"
                        onClick={handleExitSession}
                        disabled={exitingSession}
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <LogOut className="h-4 w-4" />
                        {exitingSession ? 'Exiting Session...' : 'Exit Practice Session'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                    <h3 className="font-semibold text-slate-900">
                      Privacy &amp; Audio Storage
                    </h3>
                    <p className="mt-2 leading-relaxed">
                      Your voice recordings, transcripts, and AI feedback are isolated to your verified Student ID session and visible only to you and your authorized teacher. Other students cannot access your scores or audio recordings.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
