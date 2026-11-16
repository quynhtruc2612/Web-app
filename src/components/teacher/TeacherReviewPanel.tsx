import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { setSubmissionResubmissionAllowed } from '../../lib/db';
import {
  calculateAssignmentAverageForSubmissions,
  formatDateTime,
} from '../../lib/stats';
import type { Assignment, Submission } from '../../types';
import { AssessmentFeedbackView } from '../AssessmentFeedbackView';
import { ConfirmDialog } from '../ConfirmDialog';

interface TeacherReviewPanelProps {
  studentName: string;
  studentId: string;
  studentEmail: string;
  className: string;
  selectedAssignment: Assignment;
  allAssignments: Assignment[];
  studentAllSubmissions: Submission[];
  onBack: () => void;
  onSelectAssignmentId: (assignmentId: string) => void;
  onStatusToast: (msg: string, tone?: 'success' | 'error') => void;
}

export const TeacherReviewPanel: React.FC<TeacherReviewPanelProps> = ({
  studentName,
  studentId,
  studentEmail,
  className,
  selectedAssignment,
  allAssignments,
  studentAllSubmissions,
  onBack,
  onSelectAssignmentId,
  onStatusToast,
}) => {
  const [resubmitTarget, setResubmitTarget] = useState<Submission | null>(null);
  const [updatingResubmit, setUpdatingResubmit] = useState(false);

  const currentWeekSubmissions = useMemo(
    () =>
      studentAllSubmissions.filter(
        (s) => s.assignmentId === selectedAssignment.assignmentId
      ),
    [studentAllSubmissions, selectedAssignment.assignmentId]
  );

  const weeklyTrendData = useMemo(() => {
    const sortedWeeks = [...allAssignments]
      .filter((a) => a.status !== 'draft')
      .sort((a, b) => a.weekNumber - b.weekNumber);

    return sortedWeeks
      .map((week) => {
        const subs = studentAllSubmissions.filter(
          (s) =>
            s.assignmentId === week.assignmentId &&
            s.processingStatus === 'feedback_available' &&
            s.assessment !== null
        );
        if (subs.length === 0) return null;
        const avg = calculateAssignmentAverageForSubmissions(subs).average;
        const gv =
          subs.reduce((a, s) => a + s.assessment!.grammar_vocabulary.score, 0) /
          subs.length;
        const dm =
          subs.reduce((a, s) => a + s.assessment!.discourse_management.score, 0) /
          subs.length;
        const pr =
          subs.reduce((a, s) => a + s.assessment!.pronunciation.score, 0) /
          subs.length;
        return {
          assignmentId: week.assignmentId,
          weekLabel: `W${String(week.weekNumber).padStart(2, '0')}`,
          overall: avg,
          grammar: Math.round(gv * 10) / 10,
          discourse: Math.round(dm * 10) / 10,
          pronunciation: Math.round(pr * 10) / 10,
        };
      })
      .filter(Boolean);
  }, [allAssignments, studentAllSubmissions]);

  const weekAverage = calculateAssignmentAverageForSubmissions(
    currentWeekSubmissions
  );

  const handleToggleResubmission = async () => {
    if (!resubmitTarget) return;
    setUpdatingResubmit(true);
    try {
      const next = !resubmitTarget.resubmissionAllowed;
      await setSubmissionResubmissionAllowed(resubmitTarget.submissionId, next);
      onStatusToast(
        next
          ? 'Resubmission enabled for this question.'
          : 'Resubmission permission revoked.',
        'success'
      );
    } catch (err: any) {
      onStatusToast(err?.message || 'Unable to update resubmission permission.', 'error');
    } finally {
      setUpdatingResubmit(false);
      setResubmitTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Submissions
        </button>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-500">
            Review Week:
          </label>
          <select
            value={selectedAssignment.assignmentId}
            onChange={(e) => onSelectAssignmentId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
          >
            {allAssignments
              .slice()
              .sort((a, b) => b.weekNumber - a.weekNumber)
              .map((a) => (
                <option key={a.assignmentId} value={a.assignmentId}>
                  Week {String(a.weekNumber).padStart(2, '0')} — {a.title}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Student Header Card */}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 md:grid-cols-12 md:items-center">
        <div className="md:col-span-7">
          <p className="text-xs font-medium text-slate-500">
            {studentId || 'No ID'} · {className || 'Unassigned'}
            {studentEmail ? ` · ${studentEmail}` : ''}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{studentName}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Week {String(selectedAssignment.weekNumber).padStart(2, '0')}:{' '}
            {selectedAssignment.title} · {selectedAssignment.topic}
          </p>
        </div>
        <div className="flex flex-wrap gap-6 md:col-span-5 md:justify-end">
          <div>
            <p className="text-xs text-slate-500">Questions Completed</p>
            <p className="mt-0.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {currentWeekSubmissions.filter((s) => s.processingStatus === 'feedback_available').length}{' '}
              / {selectedAssignment.questions.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Week Average</p>
            <p className="mt-0.5 font-mono text-2xl font-bold text-blue-700 tabular-nums">
              {weekAverage.average !== null
                ? `${weekAverage.average.toFixed(1)} / 5`
                : weekAverage.hasPending
                ? 'Processing'
                : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Cross-Week Trend Comparison */}
      {weeklyTrendData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Cross-Week Progress Comparison
              </h3>
              <p className="text-xs text-slate-500">
                Scores across completed weeks (0–5 scale)
              </p>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="weekLabel" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="overall"
                  name="Overall"
                  stroke="#1d4ed8"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
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
        </div>
      )}

      {/* Question-by-Question Review */}
      <div className="space-y-5">
        {selectedAssignment.questions.map((q, idx) => {
          const sub = currentWeekSubmissions.find(
            (s) => s.questionId === q.questionId
          );

          return (
            <div
              key={q.questionId}
              className="rounded-xl border border-slate-200 bg-white p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500">
                    Question {idx + 1} · {sub ? `Submitted ${formatDateTime(sub.submittedAt)}` : 'Not Submitted'}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">
                    {sub?.questionPromptSnapshot || q.prompt}
                  </h3>
                </div>

                {sub && (
                  <button
                    type="button"
                    onClick={() => setResubmitTarget(sub)}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      sub.resubmissionAllowed
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {sub.resubmissionAllowed ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Resubmission Enabled
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Allow Resubmission
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="mt-4">
                {sub ? (
                  <AssessmentFeedbackView submission={sub} />
                ) : (
                  <p className="text-sm text-slate-500">
                    This student has not submitted an answer for this question yet.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(resubmitTarget)}
        title={
          resubmitTarget?.resubmissionAllowed
            ? 'Revoke Resubmission Permission'
            : 'Allow Student Resubmission'
        }
        message={
          resubmitTarget?.resubmissionAllowed
            ? 'Prevent this student from replacing their existing submission for this question?'
            : 'Allow this student to record and submit a new answer for this question while the week is open?'
        }
        confirmLabel={
          resubmitTarget?.resubmissionAllowed
            ? 'Revoke Permission'
            : 'Allow Resubmission'
        }
        tone="warning"
        loading={updatingResubmit}
        onConfirm={handleToggleResubmission}
        onCancel={() => setResubmitTarget(null)}
      />
    </div>
  );
};
