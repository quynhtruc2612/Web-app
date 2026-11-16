import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildRosterAndUserDirectory,
  buildWeeklyStudentSummaries,
  computeCriterionAverages,
  formatDateShort,
  submissionBelongsToStudent,
} from '../../lib/stats';
import type {
  Assignment,
  StudentRosterEntry,
  Submission,
  UserProfile,
} from '../../types';

interface TeacherAnalyticsViewProps {
  assignments: Assignment[];
  roster: StudentRosterEntry[];
  users: UserProfile[];
  submissions: Submission[];
  onInspectStudent: (studentUidOrEmail: string, assignmentId: string) => void;
}

export const TeacherAnalyticsView: React.FC<TeacherAnalyticsViewProps> = ({
  assignments,
  roster,
  users,
  submissions,
  onInspectStudent,
}) => {
  const sortedAssignments = useMemo(
    () => [...assignments].sort((a, b) => b.weekNumber - a.weekNumber),
    [assignments]
  );

  const [weekFilter, setWeekFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<string>('all');
  const [selectedStudentKey, setSelectedStudentKey] = useState<string>('all');

  const directory = useMemo(
    () => buildRosterAndUserDirectory(roster, users),
    [roster, users]
  );

  const classOptions = useMemo(() => {
    const set = new Set<string>();
    directory.forEach((s) => {
      if (s.className) set.add(s.className);
    });
    return Array.from(set).sort();
  }, [directory]);

  const filteredAssignments = useMemo(() => {
    return sortedAssignments.filter((a) => {
      if (weekFilter !== 'all' && a.assignmentId !== weekFilter) return false;
      if (
        assignmentStatusFilter !== 'all' &&
        a.status !== assignmentStatusFilter
      )
        return false;
      return true;
    });
  }, [sortedAssignments, weekFilter, assignmentStatusFilter]);

  const activeWeekForOverview = useMemo(() => {
    if (weekFilter !== 'all') {
      return sortedAssignments.find((a) => a.assignmentId === weekFilter) || null;
    }
    return (
      sortedAssignments.find((a) => a.status === 'open') ||
      sortedAssignments[0] ||
      null
    );
  }, [sortedAssignments, weekFilter]);

  const filteredStudents = useMemo(() => {
    return directory.filter((s) => {
      if (classFilter !== 'all' && s.className !== classFilter) return false;
      if (selectedStudentKey !== 'all' && s.key !== selectedStudentKey)
        return false;
      return true;
    });
  }, [directory, classFilter, selectedStudentKey]);

  const filteredSubmissions = useMemo(() => {
    const allowedAssignmentIds = new Set(
      filteredAssignments.map((a) => a.assignmentId)
    );
    return submissions.filter((s) => {
      if (!allowedAssignmentIds.has(s.assignmentId)) return false;
      if (!filteredStudents.some((stu) => submissionBelongsToStudent(s, stu)))
        return false;
      if (statusFilter !== 'all' && s.processingStatus !== statusFilter)
        return false;
      return true;
    });
  }, [submissions, filteredAssignments, filteredStudents, statusFilter]);

  const criterionAvgs = useMemo(
    () => computeCriterionAverages(filteredSubmissions),
    [filteredSubmissions]
  );

  const weekOverviewStats = useMemo(() => {
    if (!activeWeekForOverview) {
      return {
        totalStudents: filteredStudents.length,
        submittedCount: 0,
        notSubmittedCount: filteredStudents.length,
        completionRate: 0,
        awaitingAiCount: 0,
        weekAverage: null as number | null,
      };
    }
    const summaries = buildWeeklyStudentSummaries({
      assignment: activeWeekForOverview,
      students: filteredStudents,
      submissions,
    });
    const total = summaries.length;
    const submittedCount = summaries.filter(
      (s) => s.status !== 'Not Started'
    ).length;
    const notSubmittedCount = total - submittedCount;
    const completionRate =
      total > 0 ? Math.round((submittedCount / total) * 100) : 0;
    const awaitingAiCount = summaries
      .flatMap((s) => s.submissions)
      .filter((sub) => sub.processingStatus === 'processing').length;

    const assessedScores = summaries
      .map((s) => s.averageScore)
      .filter((v): v is number => v !== null);
    const weekAverage =
      assessedScores.length > 0
        ? Math.round(
            (assessedScores.reduce((a, b) => a + b, 0) / assessedScores.length) *
              10
          ) / 10
        : null;

    return {
      totalStudents: total,
      submittedCount,
      notSubmittedCount,
      completionRate,
      awaitingAiCount,
      weekAverage,
    };
  }, [activeWeekForOverview, filteredStudents, submissions]);

  const criteriaChartData = useMemo(() => {
    if (criterionAvgs.assessedCount === 0) return [];
    return [
      {
        criterion: 'Grammar & Vocabulary',
        average: criterionAvgs.grammarVocabulary ?? 0,
      },
      {
        criterion: 'Discourse Management',
        average: criterionAvgs.discourseManagement ?? 0,
      },
      {
        criterion: 'Pronunciation',
        average: criterionAvgs.pronunciation ?? 0,
      },
    ];
  }, [criterionAvgs]);

  const weeklyTrendData = useMemo(() => {
    const asc = [...sortedAssignments]
      .filter((a) => a.status !== 'draft')
      .sort((a, b) => a.weekNumber - b.weekNumber);

    return asc.map((week) => {
      const weekSubs = filteredSubmissions.filter(
        (s) => s.assignmentId === week.assignmentId
      );
      const avgs = computeCriterionAverages(weekSubs);
      return {
        weekLabel: `Week ${String(week.weekNumber).padStart(2, '0')}`,
        overall: avgs.overall,
        grammar: avgs.grammarVocabulary,
        discourse: avgs.discourseManagement,
        pronunciation: avgs.pronunciation,
        count: avgs.assessedCount,
      };
    });
  }, [sortedAssignments, filteredSubmissions]);

  const exportCsvReport = () => {
    const targetWeek = activeWeekForOverview;
    if (!targetWeek) return;
    const summaries = buildWeeklyStudentSummaries({
      assignment: targetWeek,
      students: filteredStudents,
      submissions,
    });

    const headers = [
      'Week',
      'Student ID',
      'Student Name',
      'Email',
      'Class',
      'Submission Status',
      'Questions Completed',
      'Total Questions',
      'Grammar & Vocabulary Avg',
      'Discourse Management Avg',
      'Pronunciation Avg',
      'Overall Score',
      'Latest Submission Date',
    ];

    const rows = summaries.map((row) => {
      const avgs = computeCriterionAverages(row.submissions);
      return [
        `Week ${String(targetWeek.weekNumber).padStart(2, '0')}`,
        row.studentId,
        row.studentName,
        row.studentEmail,
        row.className,
        row.status,
        String(row.completedQuestions),
        String(row.totalQuestions),
        avgs.grammarVocabulary !== null ? avgs.grammarVocabulary.toFixed(1) : 'N/A',
        avgs.discourseManagement !== null ? avgs.discourseManagement.toFixed(1) : 'N/A',
        avgs.pronunciation !== null ? avgs.pronunciation.toFixed(1) : 'N/A',
        row.averageScore !== null ? row.averageScore.toFixed(1) : 'N/A',
        row.latestSubmittedAt ? formatDateShort(row.latestSubmittedAt) : 'N/A',
      ];
    });

    const csvContent = [headers, ...rows]
      .map((line) =>
        line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `b1-speaking-week-${targetWeek.weekNumber}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600">
              Week
            </label>
            <select
              value={weekFilter}
              onChange={(e) => setWeekFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All Weeks</option>
              {sortedAssignments.map((a) => (
                <option key={a.assignmentId} value={a.assignmentId}>
                  Week {String(a.weekNumber).padStart(2, '0')} · {a.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600">
              Class
            </label>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All Classes</option>
              {classOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600">
              Student
            </label>
            <select
              value={selectedStudentKey}
              onChange={(e) => setSelectedStudentKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All Students</option>
              {directory.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.fullName} ({s.studentId})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600">
              Assignment Status
            </label>
            <select
              value={assignmentStatusFilter}
              onChange={(e) => setAssignmentStatusFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="locked">Locked</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600">
              Submission Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All</option>
              <option value="feedback_available">Feedback Available</option>
              <option value="processing">Processing</option>
              <option value="needs_rerecording">Needs Re-recording</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={exportCsvReport}
          disabled={!activeWeekForOverview}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          Export CSV Report
        </button>
      </div>

      {/* Weekly Overview KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Total Students</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {weekOverviewStats.totalStudents}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Submitted</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {weekOverviewStats.submittedCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Not Submitted</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-700 tabular-nums">
            {weekOverviewStats.notSubmittedCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Completion Rate</p>
          <p className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
            {weekOverviewStats.completionRate}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Awaiting AI</p>
          <p className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums">
            {weekOverviewStats.awaitingAiCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Week Average</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {weekOverviewStats.weekAverage !== null
              ? `${weekOverviewStats.weekAverage.toFixed(1)}/5`
              : 'N/A'}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Three-Criterion Comparison
              </h3>
              <p className="text-xs text-slate-500">
                Calculated from {criterionAvgs.assessedCount} assessed responses
              </p>
            </div>
          </div>

          {criteriaChartData.length === 0 ? (
            <div className="flex h-60 items-center justify-center text-sm text-slate-500">
              No assessed submissions available for the selected filters yet.
            </div>
          ) : (
            <div className="mt-4 h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={criteriaChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="criterion" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="average" name="Average Score" fill="#1d4ed8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Weekly Score Trend
            </h3>
            <p className="text-xs text-slate-500">
              Comparing overall and criterion averages across published weeks
            </p>
          </div>

          {weeklyTrendData.every((d) => d.count === 0) ? (
            <div className="flex h-60 items-center justify-center text-sm text-slate-500">
              Trends will appear once students complete assessed weekly submissions.
            </div>
          ) : (
            <div className="mt-4 h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="weekLabel" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="overall" name="Overall" stroke="#1d4ed8" strokeWidth={2.5} connectNulls />
                  <Line type="monotone" dataKey="grammar" name="Grammar & Vocab" stroke="#059669" strokeWidth={1.75} connectNulls />
                  <Line type="monotone" dataKey="discourse" name="Discourse" stroke="#d97706" strokeWidth={1.75} connectNulls />
                  <Line type="monotone" dataKey="pronunciation" name="Pronunciation" stroke="#6366f1" strokeWidth={1.75} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Student Performance Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Individual Student Averages
            </h3>
            <p className="text-xs text-slate-500">
              Click Inspect to listen to recordings and compare performance across weeks
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Student</th>
                <th className="py-2.5 pr-4">Class</th>
                <th className="py-2.5 pr-4 text-right">Assessed Answers</th>
                <th className="py-2.5 pr-4 text-right">Grammar & Vocab</th>
                <th className="py-2.5 pr-4 text-right">Discourse</th>
                <th className="py-2.5 pr-4 text-right">Pronunciation</th>
                <th className="py-2.5 pr-4 text-right">Overall</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No students match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((stu) => {
                  const stuSubs = filteredSubmissions.filter((s) =>
                    submissionBelongsToStudent(s, stu)
                  );
                  const avgs = computeCriterionAverages(stuSubs);
                  return (
                    <tr key={stu.key} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-slate-900">{stu.fullName}</p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {stu.studentId}
                          {stu.email ? ` · ${stu.email}` : ''}
                        </p>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{stu.className}</td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {avgs.assessedCount}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {avgs.grammarVocabulary !== null
                          ? avgs.grammarVocabulary.toFixed(1)
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {avgs.discourseManagement !== null
                          ? avgs.discourseManagement.toFixed(1)
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {avgs.pronunciation !== null
                          ? avgs.pronunciation.toFixed(1)
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums text-blue-700">
                        {avgs.overall !== null ? avgs.overall.toFixed(1) : '—'}
                      </td>
                      <td className="py-3 text-right">
                        {activeWeekForOverview && (
                          <button
                            type="button"
                            onClick={() =>
                              onInspectStudent(
                                stu.key,
                                activeWeekForOverview.assignmentId
                              )
                            }
                            className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
                          >
                            Inspect
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
