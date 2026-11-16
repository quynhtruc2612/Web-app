import React, { useEffect, useMemo, useState } from 'react';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  addRosterStudent,
  bulkImportRosterStudents,
  createAssignment,
  deleteAssignment,
  deleteRosterStudent,
  setAssignmentStatus,
  updateAssignment,
  updateRosterStudent,
} from '../../lib/db';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  buildRosterAndUserDirectory,
  buildWeeklyStudentSummaries,
  formatDateShort,
  formatDateTime,
} from '../../lib/stats';
import type {
  AccountStatus,
  Assignment,
  AssignmentStatus,
  SpeakingQuestion,
  StudentRosterEntry,
  Submission,
  UserProfile,
} from '../../types';
import { ConfirmDialog } from '../ConfirmDialog';
import { AssignmentFormModal } from './AssignmentFormModal';
import { TeacherAnalyticsView } from './TeacherAnalyticsView';
import { TeacherReviewPanel } from './TeacherReviewPanel';

type TeacherTab =
  | 'dashboard'
  | 'weeks'
  | 'students'
  | 'submissions'
  | 'analytics'
  | 'settings';

interface TeacherDashboardProps {
  profile: UserProfile;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  profile,
}) => {
  const [activeTab, setActiveTab] = useState<TeacherTab>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [roster, setRoster] = useState<StudentRosterEntry[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  const [healthInfo, setHealthInfo] = useState<{
    geminiConfigured: boolean;
    firebaseProjectConfigured: boolean;
  } | null>(null);

  // Weekly Management states
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'primary' | 'danger' | 'warning';
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Student Management states
  const [studentSearch, setStudentSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('all');
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [editingRoster, setEditingRoster] = useState<StudentRosterEntry | null>(null);
  const [stuForm, setStuForm] = useState({
    studentId: '',
    fullName: '',
    email: '',
    className: 'B1-A',
    accountStatus: 'active' as AccountStatus,
  });
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvPreviewRows, setCsvPreviewRows] = useState<
    Array<{ studentId: string; fullName: string; email: string; className: string }>
  >([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Submission Management & Review states
  const [selectedWeekId, setSelectedWeekId] = useState<string>('');
  const [subClassFilter, setSubClassFilter] = useState('all');
  const [subStatusFilter, setSubStatusFilter] = useState('all');
  const [subSearch, setSubSearch] = useState('');
  const [subSortBy, setSubSortBy] = useState<'name' | 'score' | 'date'>('name');
  const [reviewingStudentKey, setReviewingStudentKey] = useState<string | null>(
    null
  );

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealthInfo(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const qAssignments = query(
      collection(db, 'assignments'),
      orderBy('weekNumber', 'desc')
    );
    unsubs.push(
      onSnapshot(
        qAssignments,
        (snap) => {
          const list = snap.docs.map((d) => d.data() as Assignment);
          setAssignments(list);
          setLoadingData(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'assignments')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'studentRoster'),
        (snap) => {
          setRoster(snap.docs.map((d) => d.data() as StudentRosterEntry));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'studentRoster')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'users'),
        (snap) => {
          setUsers(snap.docs.map((d) => d.data() as UserProfile));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'users')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'submissions'),
        (snap) => {
          setSubmissions(snap.docs.map((d) => d.data() as Submission));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'submissions')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, []);

  const openAssignment = useMemo(
    () => assignments.find((a) => a.status === 'open') || null,
    [assignments]
  );

  useEffect(() => {
    if (!selectedWeekId && assignments.length > 0) {
      setSelectedWeekId(
        openAssignment?.assignmentId || assignments[0].assignmentId
      );
    }
  }, [assignments, openAssignment, selectedWeekId]);

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

  const activeWeekForDashboard = openAssignment || assignments[0] || null;

  const dashboardWeekSummaries = useMemo(() => {
    if (!activeWeekForDashboard) return [];
    return buildWeeklyStudentSummaries({
      assignment: activeWeekForDashboard,
      students: directory,
      submissions,
    });
  }, [activeWeekForDashboard, directory, submissions]);

  const dashboardKpis = useMemo(() => {
    const totalStudents = directory.length;
    const totalAssignments = assignments.length;
    const completedThisWeek = dashboardWeekSummaries.filter(
      (s) => s.status !== 'Not Started'
    ).length;
    const notSubmittedThisWeek = Math.max(0, totalStudents - completedThisWeek);
    const completionRate =
      totalStudents > 0
        ? Math.round((completedThisWeek / totalStudents) * 100)
        : 0;

    return {
      totalStudents,
      totalAssignments,
      completedThisWeek,
      notSubmittedThisWeek,
      completionRate,
    };
  }, [directory.length, assignments.length, dashboardWeekSummaries]);

  const recentSubmissions = useMemo(() => {
    return [...submissions]
      .sort((a, b) => {
        const ta = a.submittedAt?.seconds || 0;
        const tb = b.submittedAt?.seconds || 0;
        return tb - ta;
      })
      .slice(0, 8);
  }, [submissions]);

  const suggestedWeekNumber = useMemo(() => {
    if (assignments.length === 0) return 1;
    return Math.max(...assignments.map((a) => a.weekNumber)) + 1;
  }, [assignments]);

  // Submission table rows
  const selectedWeekAssignment = useMemo(
    () =>
      assignments.find((a) => a.assignmentId === selectedWeekId) ||
      openAssignment ||
      assignments[0] ||
      null,
    [assignments, selectedWeekId, openAssignment]
  );

  const weeklySummaries = useMemo(() => {
    if (!selectedWeekAssignment) return [];
    const base = buildWeeklyStudentSummaries({
      assignment: selectedWeekAssignment,
      students: directory,
      submissions,
    });

    return base
      .filter((row) => {
        if (subClassFilter !== 'all' && row.className !== subClassFilter)
          return false;
        if (subStatusFilter !== 'all' && row.status !== subStatusFilter)
          return false;
        if (subSearch.trim()) {
          const q = subSearch.trim().toLowerCase();
          if (
            !row.studentName.toLowerCase().includes(q) &&
            !row.studentId.toLowerCase().includes(q) &&
            !row.studentEmail.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (subSortBy === 'score') {
          return (b.averageScore ?? -1) - (a.averageScore ?? -1);
        }
        if (subSortBy === 'date') {
          return (
            (b.latestSubmittedAt?.getTime() || 0) -
            (a.latestSubmittedAt?.getTime() || 0)
          );
        }
        return a.studentName.localeCompare(b.studentName);
      });
  }, [
    selectedWeekAssignment,
    directory,
    submissions,
    subClassFilter,
    subStatusFilter,
    subSearch,
    subSortBy,
  ]);

  const handleSaveAssignment = async (payload: {
    weekNumber: number;
    title: string;
    topic: string;
    instructions: string;
    questions: SpeakingQuestion[];
    deadline: string;
    status: AssignmentStatus;
    lockOtherOpenWeekId?: string;
  }) => {
    if (payload.lockOtherOpenWeekId) {
      const other = assignments.find(
        (a) => a.assignmentId === payload.lockOtherOpenWeekId
      );
      if (other) {
        await setAssignmentStatus(other, 'locked');
      }
    }

    if (editingAssignment) {
      await updateAssignment(editingAssignment.assignmentId, {
        ...payload,
        existingPublishedAt: editingAssignment.publishedAt,
      });
      showToast(`Week ${String(payload.weekNumber).padStart(2, '0')} updated.`);
    } else {
      await createAssignment({
        ...payload,
        createdBy: profile.userId,
      });
      showToast(
        payload.status === 'open'
          ? `Week ${String(payload.weekNumber).padStart(2, '0')} published and opened.`
          : `Week ${String(payload.weekNumber).padStart(2, '0')} saved as draft.`
      );
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.action();
    } catch (err: any) {
      showToast(err?.message || 'Action failed. Please try again.', 'error');
    } finally {
      setConfirmBusy(false);
      setConfirmState(null);
    }
  };

  const handleStatusChangeRequest = (
    assignment: Assignment,
    target: AssignmentStatus
  ) => {
    if (target === 'locked') {
      setConfirmState({
        open: true,
        title: `Lock Week ${String(assignment.weekNumber).padStart(2, '0')}`,
        message:
          'Locking this week prevents students from submitting new recordings. All existing student audio, transcripts, and AI feedback remain intact.',
        confirmLabel: 'Lock Week',
        tone: 'warning',
        action: async () => {
          await setAssignmentStatus(assignment, 'locked');
          showToast(
            `Week ${String(assignment.weekNumber).padStart(2, '0')} is now locked.`
          );
        },
      });
      return;
    }

    if (target === 'open') {
      const otherOpen = assignments.find(
        (a) => a.status === 'open' && a.assignmentId !== assignment.assignmentId
      );
      setConfirmState({
        open: true,
        title: `Open Week ${String(assignment.weekNumber).padStart(2, '0')}`,
        message: otherOpen
          ? `Week ${String(otherOpen.weekNumber).padStart(2, '0')} ("${otherOpen.title}") is currently open. Opening this week will automatically lock Week ${String(otherOpen.weekNumber).padStart(2, '0')} so only one week is active at a time.`
          : 'Publishing and opening this week will make all questions available for students to record and submit.',
        confirmLabel: 'Open Week',
        tone: 'primary',
        action: async () => {
          if (otherOpen) {
            await setAssignmentStatus(otherOpen, 'locked');
          }
          await setAssignmentStatus(assignment, 'open');
          showToast(
            `Week ${String(assignment.weekNumber).padStart(2, '0')} is now open.`
          );
        },
      });
    }
  };

  const handleDeleteAssignmentRequest = (assignment: Assignment) => {
    setConfirmState({
      open: true,
      title: `Delete Week ${String(assignment.weekNumber).padStart(2, '0')}`,
      message: `Are you sure you want to permanently delete "${assignment.title}"? Existing submission records will remain in the database, but the assignment card will be removed.`,
      confirmLabel: 'Delete Assignment',
      tone: 'danger',
      action: async () => {
        await deleteAssignment(assignment.assignmentId);
        showToast('Assignment deleted.');
      },
    });
  };

  // Student CRUD
  const openAddStudentModal = () => {
    setEditingRoster(null);
    setStuForm({
      studentId: '',
      fullName: '',
      email: '',
      className: classOptions[0] || 'B1-A',
      accountStatus: 'active',
    });
    setStudentModalOpen(true);
  };

  const openEditStudentModal = (entry: StudentRosterEntry) => {
    setEditingRoster(entry);
    setStuForm({
      studentId: entry.studentId,
      fullName: entry.fullName,
      email: entry.email,
      className: entry.className,
      accountStatus: entry.accountStatus,
    });
    setStudentModalOpen(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stuForm.studentId.trim() || !stuForm.fullName.trim() || !stuForm.email.trim()) {
      showToast('Please fill in Student ID, Full Name, and Email.', 'error');
      return;
    }
    try {
      if (editingRoster) {
        await updateRosterStudent(editingRoster, stuForm);
        showToast('Student information updated.');
      } else {
        await addRosterStudent({
          ...stuForm,
          createdBy: profile.userId,
        });
        showToast('Student added to roster.');
      }
      setStudentModalOpen(false);
    } catch (err: any) {
      showToast(err?.message || 'Unable to save student.', 'error');
    }
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        setCsvError('The selected CSV file is empty.');
        return;
      }

      const parsed: Array<{
        studentId: string;
        fullName: string;
        email: string;
        className: string;
      }> = [];

      lines.forEach((line, idx) => {
        const cols = line
          .split(',')
          .map((c) => c.trim().replace(/^"|"$/g, ''));
        if (
          idx === 0 &&
          (cols[0]?.toLowerCase().includes('student') ||
            cols[2]?.toLowerCase().includes('email'))
        ) {
          return; // skip header row
        }
        if (cols.length >= 3 && cols[2].includes('@')) {
          parsed.push({
            studentId: cols[0] || `ST-${idx}`,
            fullName: cols[1] || 'Student',
            email: cols[2].toLowerCase(),
            className: cols[3] || 'B1-A',
          });
        }
      });

      if (parsed.length === 0) {
        setCsvError(
          'No valid student rows found. Expected columns: studentId,fullName,email,className'
        );
        return;
      }
      setCsvPreviewRows(parsed);
    } catch {
      setCsvError('Failed to read CSV file.');
    }
  };

  const handleConfirmCsvImport = async () => {
    if (csvPreviewRows.length === 0) return;
    try {
      const count = await bulkImportRosterStudents(
        csvPreviewRows,
        profile.userId
      );
      showToast(`Imported ${count} students into the roster.`);
      setCsvPreviewRows([]);
      setCsvModalOpen(false);
    } catch (err: any) {
      setCsvError(err?.message || 'CSV import failed.');
    }
  };

  const downloadCsvTemplate = () => {
    const template =
      'studentId,fullName,email,className\nB1-001,Nguyen Minh Anh,minhanh@example.com,B1-Morning\nB1-002,Tran Hoang Nam,hoangnam@example.com,B1-Morning';
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const navItems: Array<{ id: TeacherTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      id: 'weeks',
      label: 'Weekly Questions',
      icon: <BookOpen className="h-4 w-4" />,
    },
    {
      id: 'students',
      label: 'Student Management',
      icon: <Users className="h-4 w-4" />,
    },
    {
      id: 'submissions',
      label: 'Submissions',
      icon: <ClipboardCheck className="h-4 w-4" />,
    },
    {
      id: 'analytics',
      label: 'Performance Analytics',
      icon: <BarChart3 className="h-4 w-4" />,
    },
    {
      id: 'settings',
      label: 'Account Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  const filteredRosterEntries = useMemo(() => {
    return roster.filter((r) => {
      if (studentClassFilter !== 'all' && r.className !== studentClassFilter)
        return false;
      if (studentSearch.trim()) {
        const q = studentSearch.trim().toLowerCase();
        if (
          !r.fullName.toLowerCase().includes(q) &&
          !r.studentId.toLowerCase().includes(q) &&
          !r.email.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [roster, studentClassFilter, studentSearch]);

  const reviewingTarget = useMemo(() => {
    if (!reviewingStudentKey || !selectedWeekAssignment) return null;
    const stu = directory.find(
      (s) =>
        s.key === reviewingStudentKey ||
        s.uid === reviewingStudentKey ||
        s.email === reviewingStudentKey
    );
    if (!stu) return null;
    const allStuSubs = submissions.filter(
      (s) =>
        (stu.uid && s.studentUid === stu.uid) ||
        s.studentEmail.toLowerCase() === stu.email.toLowerCase()
    );
    return {
      student: stu,
      submissions: allStuSubs,
    };
  }, [reviewingStudentKey, selectedWeekAssignment, directory, submissions]);

  const pageTitleMap: Record<TeacherTab, string> = {
    dashboard: 'Teacher Overview',
    weeks: 'Weekly Question Management',
    students: 'Student Management',
    submissions: 'Submission Management',
    analytics: 'Performance Analytics',
    settings: 'Account Settings',
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      {/* Mobile drawer backdrop */}
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
                  setReviewingStudentKey(null);
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
              Teacher · {profile.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
                {pageTitleMap[activeTab]}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingAssignment(null);
                setAssignmentModalOpen(true);
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              Create New Week
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
          {toast && (
            <div
              role="status"
              className={`mb-6 flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium ${
                toast.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="ml-4 text-xs underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {loadingData ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
                  />
                ))}
              </div>
              <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
            </div>
          ) : (
            <>
              {/* 1. DASHBOARD OVERVIEW */}
              {activeTab === 'dashboard' && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Total Students
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                        {dashboardKpis.totalStudents}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Total Weekly Assignments
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                        {dashboardKpis.totalAssignments}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Completed This Week
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                        {dashboardKpis.completedThisWeek}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Not Yet Submitted
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-amber-700 tabular-nums">
                        {dashboardKpis.notSubmittedThisWeek}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">
                        Weekly Completion Rate
                      </p>
                      <p className="mt-1.5 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                        {dashboardKpis.completionRate}%
                      </p>
                    </div>
                  </div>

                  {/* Active Assignment Overview + Recent Submissions */}
                  <div className="grid gap-6 lg:grid-cols-12">
                    <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold text-slate-900">
                          Current Active Assignment
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('weeks')}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          Manage Weeks
                        </button>
                      </div>

                      {openAssignment ? (
                        <div className="mt-4 space-y-4">
                          <div>
                            <p className="text-xs font-semibold text-emerald-700">
                              Open · Week {String(openAssignment.weekNumber).padStart(2, '0')}
                              {openAssignment.deadline
                                ? ` · Due ${openAssignment.deadline}`
                                : ''}
                            </p>
                            <h3 className="mt-1 text-lg font-bold text-slate-900">
                              {openAssignment.title}
                            </h3>
                            <p className="mt-0.5 text-sm text-slate-600">
                              Topic: {openAssignment.topic}
                            </p>
                          </div>

                          <div className="border-t border-slate-100 pt-3">
                            <p className="text-xs font-semibold text-slate-500">
                              Questions ({openAssignment.questions.length})
                            </p>
                            <ul className="mt-2 space-y-2 text-sm text-slate-700">
                              {openAssignment.questions.map((q, idx) => (
                                <li key={q.questionId} className="leading-snug">
                                  <span className="font-mono text-xs font-semibold text-slate-500">
                                    Q{idx + 1}.
                                  </span>{' '}
                                  {q.prompt}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex flex-wrap gap-3 pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedWeekId(openAssignment.assignmentId);
                                setActiveTab('submissions');
                              }}
                              className="min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                            >
                              Track Submissions
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleStatusChangeRequest(openAssignment, 'locked')
                              }
                              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              Lock Week
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3 text-sm text-slate-600">
                          <p>
                            No weekly assignment is currently open for students.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAssignment(null);
                              setAssignmentModalOpen(true);
                            }}
                            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                          >
                            <Plus className="h-4 w-4" />
                            Create & Publish Week
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold text-slate-900">
                          Recent Student Submissions
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('submissions')}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          View All
                        </button>
                      </div>

                      {recentSubmissions.length === 0 ? (
                        <div className="py-12 text-center text-sm text-slate-500">
                          No student submissions recorded yet. Once you open a week and students submit recordings, they will appear here.
                        </div>
                      ) : (
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                                <th className="py-2 pr-3">Student</th>
                                <th className="py-2 pr-3">Week</th>
                                <th className="py-2 pr-3">Status</th>
                                <th className="py-2 pr-3 text-right">Score</th>
                                <th className="py-2 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {recentSubmissions.map((sub) => (
                                <tr key={sub.submissionId}>
                                  <td className="py-2.5 pr-3">
                                    <p className="font-medium text-slate-900">
                                      {sub.studentName}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {formatDateTime(sub.submittedAt)}
                                    </p>
                                  </td>
                                  <td className="py-2.5 pr-3 text-slate-600 tabular-nums">
                                    Week {String(sub.weekNumber).padStart(2, '0')}
                                  </td>
                                  <td className="py-2.5 pr-3 text-xs font-medium">
                                    {sub.processingStatus === 'feedback_available' ? (
                                      <span className="text-emerald-700">
                                        Feedback Available
                                      </span>
                                    ) : sub.processingStatus === 'processing' ? (
                                      <span className="text-blue-700">Processing</span>
                                    ) : sub.processingStatus === 'needs_rerecording' ? (
                                      <span className="text-amber-700">
                                        Needs Re-recording
                                      </span>
                                    ) : (
                                      <span className="text-red-700">Failed</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                                    {sub.overallScore !== null
                                      ? `${sub.overallScore.toFixed(1)}/5`
                                      : '—'}
                                  </td>
                                  <td className="py-2.5 text-right">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedWeekId(sub.assignmentId);
                                        setReviewingStudentKey(sub.studentUid);
                                        setActiveTab('submissions');
                                      }}
                                      className="text-xs font-semibold text-blue-700 hover:underline"
                                    >
                                      Review
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 2. WEEKLY QUESTION MANAGEMENT */}
              {activeTab === 'weeks' && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-600">
                        Create weekly speaking assignments, edit questions, and control whether a week is Draft, Open, or Locked.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAssignment(null);
                        setAssignmentModalOpen(true);
                      }}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
                    >
                      <Plus className="h-4 w-4" />+ Create New Week
                    </button>
                  </div>

                  {assignments.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                      <p className="text-base font-semibold text-slate-900">
                        No weekly assignments created yet
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Click "+ Create New Week" to publish your first B1 speaking practice set.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {assignments.map((week) => {
                        const statusColor =
                          week.status === 'open'
                            ? 'text-emerald-700'
                            : week.status === 'locked'
                            ? 'text-amber-700'
                            : 'text-slate-500';
                        const statusLabel =
                          week.status === 'open'
                            ? 'Open (Active)'
                            : week.status === 'locked'
                            ? 'Locked (Read-only)'
                            : 'Draft (Hidden from students)';

                        return (
                          <div
                            key={week.assignmentId}
                            className="rounded-xl border border-slate-200 bg-white p-6"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                  <span className="font-mono font-semibold text-slate-700">
                                    Week {String(week.weekNumber).padStart(2, '0')}
                                  </span>
                                  <span>·</span>
                                  <span className={`font-semibold ${statusColor}`}>
                                    {statusLabel}
                                  </span>
                                  <span>·</span>
                                  <span>{week.questions.length} questions</span>
                                  <span>·</span>
                                  <span>Created {formatDateShort(week.createdAt)}</span>
                                  {week.deadline && (
                                    <>
                                      <span>·</span>
                                      <span>Deadline: {week.deadline}</span>
                                    </>
                                  )}
                                </div>
                                <h3 className="text-lg font-bold text-slate-900">
                                  {week.title}
                                </h3>
                                <p className="text-sm text-slate-600">
                                  Speaking Topic: {week.topic}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAssignment(week);
                                    setAssignmentModalOpen(true);
                                  }}
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  Edit Week
                                </button>

                                {week.status !== 'open' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStatusChangeRequest(week, 'open')
                                    }
                                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                                  >
                                    <Unlock className="h-3.5 w-3.5" />
                                    {week.status === 'locked'
                                      ? 'Reopen Week'
                                      : 'Open Week'}
                                  </button>
                                )}

                                {week.status === 'open' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStatusChangeRequest(week, 'locked')
                                    }
                                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap"
                                  >
                                    <Lock className="h-3.5 w-3.5" />
                                    Lock Week
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteAssignmentRequest(week)
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              </div>
                            </div>

                            {week.instructions && (
                              <p className="mt-3 text-sm text-slate-600">
                                {week.instructions}
                              </p>
                            )}

                            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                              {week.questions.map((q, idx) => (
                                <div
                                  key={q.questionId}
                                  className="flex items-start gap-2.5 text-sm text-slate-700"
                                >
                                  <span className="font-mono text-xs font-semibold text-slate-500 mt-0.5">
                                    Q{idx + 1}.
                                  </span>
                                  <span>{q.prompt}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 3. STUDENT MANAGEMENT */}
              {activeTab === 'students' && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap flex-1 items-center gap-3">
                      <div className="relative min-w-[220px] flex-1 max-w-sm">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={studentSearch}
                          onChange={(e) => setStudentSearch(e.target.value)}
                          placeholder="Search by student name, ID, or email..."
                          className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      <select
                        value={studentClassFilter}
                        onChange={(e) => setStudentClassFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="all">All Classes</option>
                        {classOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCsvPreviewRows([]);
                          setCsvError(null);
                          setCsvModalOpen(true);
                        }}
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Upload className="h-4 w-4" />
                        Import CSV
                      </button>

                      <button
                        type="button"
                        onClick={openAddStudentModal}
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
                      >
                        <UserPlus className="h-4 w-4" />
                        Add Student
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                            <th className="py-2.5 pr-4">Student ID</th>
                            <th className="py-2.5 pr-4">Full Name</th>
                            <th className="py-2.5 pr-4">Email</th>
                            <th className="py-2.5 pr-4">Class</th>
                            <th className="py-2.5 pr-4">Account Status</th>
                            <th className="py-2.5 pr-4">Google Link</th>
                            <th className="py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredRosterEntries.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="py-10 text-center text-slate-500"
                              >
                                No students in roster yet. Add students individually or import a CSV list.
                              </td>
                            </tr>
                          ) : (
                            filteredRosterEntries.map((stu) => (
                              <tr key={stu.rosterId} className="hover:bg-slate-50/70">
                                <td className="py-3 pr-4 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                                  {stu.studentId}
                                </td>
                                <td className="py-3 pr-4 font-medium text-slate-900">
                                  {stu.fullName}
                                </td>
                                <td className="py-3 pr-4 text-slate-600">
                                  {stu.email}
                                </td>
                                <td className="py-3 pr-4 text-slate-700">
                                  {stu.className}
                                </td>
                                <td className="py-3 pr-4 text-xs font-semibold">
                                  {stu.accountStatus === 'active' ? (
                                    <span className="text-emerald-700">Active</span>
                                  ) : (
                                    <span className="text-red-700">Inactive</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4 text-xs text-slate-500">
                                  {stu.linkedUid ? 'Signed in' : 'Pending first login'}
                                </td>
                                <td className="py-3 text-right">
                                  <div className="inline-flex items-center gap-3">
                                    {selectedWeekAssignment && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReviewingStudentKey(
                                            stu.linkedUid || stu.email
                                          );
                                          setActiveTab('submissions');
                                        }}
                                        className="text-xs font-semibold text-blue-700 hover:underline"
                                      >
                                        History
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => openEditStudentModal(stu)}
                                      className="text-xs font-semibold text-slate-700 hover:underline"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmState({
                                          open: true,
                                          title: 'Remove Student from Roster',
                                          message: `Remove ${stu.fullName} (${stu.studentId}) from the roster?`,
                                          confirmLabel: 'Remove',
                                          tone: 'danger',
                                          action: async () => {
                                            await deleteRosterStudent(stu.rosterId);
                                            showToast('Student removed from roster.');
                                          },
                                        })
                                      }
                                      className="text-xs font-semibold text-red-700 hover:underline"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. SUBMISSION MANAGEMENT & REVIEW */}
              {activeTab === 'submissions' && (
                <>
                  {reviewingTarget && selectedWeekAssignment ? (
                    <TeacherReviewPanel
                      studentName={reviewingTarget.student.fullName}
                      studentId={reviewingTarget.student.studentId}
                      studentEmail={reviewingTarget.student.email}
                      className={reviewingTarget.student.className}
                      selectedAssignment={selectedWeekAssignment}
                      allAssignments={assignments}
                      studentAllSubmissions={reviewingTarget.submissions}
                      onBack={() => setReviewingStudentKey(null)}
                      onSelectAssignmentId={(id) => setSelectedWeekId(id)}
                      onStatusToast={showToast}
                    />
                  ) : (
                    <div className="space-y-6">
                      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600">
                            Assignment Week
                          </label>
                          <select
                            value={selectedWeekAssignment?.assignmentId || ''}
                            onChange={(e) => setSelectedWeekId(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                          >
                            {assignments.map((a) => (
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
                            value={subClassFilter}
                            onChange={(e) => setSubClassFilter(e.target.value)}
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
                            Submission Status
                          </label>
                          <select
                            value={subStatusFilter}
                            onChange={(e) => setSubStatusFilter(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                          >
                            <option value="all">All Statuses</option>
                            <option value="Feedback Available">
                              Feedback Available
                            </option>
                            <option value="In Progress">In Progress</option>
                            <option value="Processing">Processing</option>
                            <option value="Not Started">Not Started</option>
                            <option value="Needs Re-recording">
                              Needs Re-recording
                            </option>
                            <option value="Failed">Failed</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-600">
                            Sort By
                          </label>
                          <select
                            value={subSortBy}
                            onChange={(e) =>
                              setSubSortBy(e.target.value as 'name' | 'score' | 'date')
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                          >
                            <option value="name">Student Name (A–Z)</option>
                            <option value="score">Highest AI Score</option>
                            <option value="date">Latest Submission</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-600">
                            Search Student
                          </label>
                          <input
                            type="text"
                            value={subSearch}
                            onChange={(e) => setSubSearch(e.target.value)}
                            placeholder="Name or Student ID..."
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-6">
                        {!selectedWeekAssignment ? (
                          <p className="py-10 text-center text-sm text-slate-500">
                            Create a weekly assignment first to track student submissions.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                                  <th className="py-2.5 pr-4">Student ID</th>
                                  <th className="py-2.5 pr-4">Student Name</th>
                                  <th className="py-2.5 pr-4">Class</th>
                                  <th className="py-2.5 pr-4">Submission Status</th>
                                  <th className="py-2.5 pr-4">Submission Date</th>
                                  <th className="py-2.5 pr-4 text-right">
                                    Questions Completed
                                  </th>
                                  <th className="py-2.5 pr-4 text-right">
                                    Overall AI Score
                                  </th>
                                  <th className="py-2.5 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {weeklySummaries.length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={8}
                                      className="py-10 text-center text-slate-500"
                                    >
                                      No students match your current filter.
                                    </td>
                                  </tr>
                                ) : (
                                  weeklySummaries.map((row) => (
                                    <tr
                                      key={row.studentEmail}
                                      className="hover:bg-slate-50/80"
                                    >
                                      <td className="py-3 pr-4 font-mono text-xs text-slate-700 tabular-nums">
                                        {row.studentId}
                                      </td>
                                      <td className="py-3 pr-4">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setReviewingStudentKey(row.studentKey)
                                          }
                                          className="font-semibold text-slate-900 hover:text-blue-700 hover:underline text-left"
                                        >
                                          {row.studentName}
                                        </button>
                                      </td>
                                      <td className="py-3 pr-4 text-slate-600">
                                        {row.className}
                                      </td>
                                      <td className="py-3 pr-4 text-xs font-semibold">
                                        <span
                                          className={
                                            row.status === 'Feedback Available'
                                              ? 'text-emerald-700'
                                              : row.status === 'Processing'
                                              ? 'text-blue-700'
                                              : row.status === 'In Progress'
                                              ? 'text-indigo-700'
                                              : row.status === 'Not Started'
                                              ? 'text-slate-500'
                                              : 'text-amber-700'
                                          }
                                        >
                                          {row.status}
                                        </span>
                                      </td>
                                      <td className="py-3 pr-4 text-slate-600">
                                        {row.latestSubmittedAt
                                          ? formatDateTime(row.latestSubmittedAt)
                                          : '—'}
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                                        {row.completedQuestions} /{' '}
                                        {row.totalQuestions}
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                                        {row.averageScore !== null
                                          ? `${row.averageScore.toFixed(1)}/5`
                                          : '—'}
                                      </td>
                                      <td className="py-3 text-right">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setReviewingStudentKey(row.studentKey)
                                          }
                                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                        >
                                          View Details
                                        </button>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 5. PERFORMANCE ANALYTICS */}
              {activeTab === 'analytics' && (
                <TeacherAnalyticsView
                  assignments={assignments}
                  roster={roster}
                  users={users}
                  submissions={submissions}
                  onInspectStudent={(key, assignmentId) => {
                    setSelectedWeekId(assignmentId);
                    setReviewingStudentKey(key);
                    setActiveTab('submissions');
                  }}
                />
              )}

              {/* 6. ACCOUNT SETTINGS */}
              {activeTab === 'settings' && (
                <div className="max-w-2xl space-y-6">
                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <h2 className="text-base font-semibold text-slate-900">
                      Teacher Account
                    </h2>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <dt className="text-slate-500">Full Name</dt>
                        <dd className="font-medium text-slate-900">
                          {profile.fullName}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <dt className="text-slate-500">Email</dt>
                        <dd className="font-medium text-slate-900">
                          {profile.email}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <dt className="text-slate-500">Role</dt>
                        <dd className="font-semibold text-blue-700">
                          Teacher (Administrator)
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Status</dt>
                        <dd className="font-semibold text-emerald-700">
                          {profile.accountStatus}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <h2 className="text-base font-semibold text-slate-900">
                      Connected Services
                    </h2>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">
                          Firebase Auth & Cloud Firestore
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                          <CheckCircle2 className="h-4 w-4" />
                          Connected
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">
                          Server-Side Gemini AI Assessment
                        </span>
                        <span
                          className={`font-semibold ${
                            healthInfo?.geminiConfigured
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {healthInfo?.geminiConfigured
                            ? 'Configured (gemini-4-hydrogen)'
                            : 'Check GEMINI_API_KEY in Secrets'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Assignment Modal */}
      <AssignmentFormModal
        open={assignmentModalOpen}
        editingAssignment={editingAssignment}
        suggestedWeekNumber={suggestedWeekNumber}
        otherOpenAssignment={openAssignment}
        onClose={() => setAssignmentModalOpen(false)}
        onSave={handleSaveAssignment}
      />

      {/* Add/Edit Student Modal */}
      {studentModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveStudent}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingRoster ? 'Edit Student' : 'Add Student to Roster'}
              </h3>
              <button
                type="button"
                onClick={() => setStudentModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Student ID
                </label>
                <input
                  type="text"
                  required
                  value={stuForm.studentId}
                  onChange={(e) =>
                    setStuForm((p) => ({ ...p, studentId: e.target.value }))
                  }
                  placeholder="e.g., B1-2026-001"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={stuForm.fullName}
                  onChange={(e) =>
                    setStuForm((p) => ({ ...p, fullName: e.target.value }))
                  }
                  placeholder="e.g., Nguyen Minh Anh"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Google Email
                </label>
                <input
                  type="email"
                  required
                  value={stuForm.email}
                  onChange={(e) =>
                    setStuForm((p) => ({ ...p, email: e.target.value }))
                  }
                  placeholder="student@gmail.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Class / Group
                  </label>
                  <input
                    type="text"
                    required
                    value={stuForm.className}
                    onChange={(e) =>
                      setStuForm((p) => ({ ...p, className: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Account Status
                  </label>
                  <select
                    value={stuForm.accountStatus}
                    onChange={(e) =>
                      setStuForm((p) => ({
                        ...p,
                        accountStatus: e.target.value as AccountStatus,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStudentModalOpen(false)}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                {editingRoster ? 'Save Changes' : 'Add Student'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Import Students from CSV
              </h3>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <p className="text-slate-600">
                Upload a CSV file with columns:{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  studentId,fullName,email,className
                </code>
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <FileSpreadsheet className="h-4 w-4" />
                  Select CSV File
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvFileUpload}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={downloadCsvTemplate}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Download CSV Template
                </button>
              </div>

              {csvError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  {csvError}
                </div>
              )}

              {csvPreviewRows.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-700">
                    Ready to import {csvPreviewRows.length} students:
                  </p>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {csvPreviewRows.map((r, idx) => (
                      <li key={idx}>
                        {r.studentId} · {r.fullName} · {r.email} · {r.className}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={csvPreviewRows.length === 0}
                onClick={handleConfirmCsvImport}
                className="min-h-[40px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
              >
                Import {csvPreviewRows.length || ''} Students
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(confirmState?.open)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirm'}
        tone={confirmState?.tone || 'primary'}
        loading={confirmBusy}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};
