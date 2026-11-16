import React, { useCallback, useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  GraduationCap,
  Mic,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { fetchPublicClassList, startVerifiedStudentSession } from '../lib/db';
import { auth, googleProvider } from '../lib/firebase';
import type { UserProfile } from '../types';

interface AuthScreenProps {
  externalError?: string | null;
  onClearExternalError?: () => void;
  onStudentAuthenticated?: (profile: UserProfile) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  externalError,
  onClearExternalError,
  onStudentAuthenticated,
}) => {
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [studentLoading, setStudentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [classOptions, setClassOptions] = useState<string[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const [fullName, setFullName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [selectedClass, setSelectedClass] = useState('');

  const loadClasses = useCallback(async () => {
    setLoadingClasses(true);
    try {
      const list = await fetchPublicClassList();
      setClassOptions(list);
      setSelectedClass((prev) =>
        prev && list.includes(prev) ? prev : list[0] || ''
      );
    } finally {
      setLoadingClasses(false);
    }
  }, []);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  const handleTeacherSignIn = async () => {
    setTeacherLoading(true);
    setError(null);
    onClearExternalError?.();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Teacher sign-in was cancelled. Click Teacher Sign In when ready.');
      } else if (err?.code === 'auth/popup-blocked') {
        setError(
          'Your browser blocked the sign-in popup. Please allow popups for this site and try again.'
        );
      } else {
        setError(err?.message || 'Unable to sign in right now. Please try again.');
      }
    } finally {
      setTeacherLoading(false);
    }
  };

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    onClearExternalError?.();

    const cleanName = fullName.trim();
    const cleanId = studentId.trim();
    const cleanClass = selectedClass.trim();

    if (!cleanName) {
      setError('Please enter your Full Name.');
      return;
    }
    if (!cleanId) {
      setError('Please enter your Student ID.');
      return;
    }
    if (!cleanClass) {
      setError('Please select your Class.');
      return;
    }

    setStudentLoading(true);
    try {
      const profile = await startVerifiedStudentSession({
        fullName: cleanName,
        studentId: cleanId,
        className: cleanClass,
      });
      onStudentAuthenticated?.(profile);
    } catch (err: any) {
      const raw = err?.message || 'Unable to verify your student record.';
      if (raw.startsWith('ANONYMOUS_AUTH_DISABLED:')) {
        setError(raw.replace('ANONYMOUS_AUTH_DISABLED:', '').trim());
      } else {
        setError(raw);
      }
    } finally {
      setStudentLoading(false);
    }
  };

  const activeError = error || externalError;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            B1 Speaking Practice
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#workflow" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#criteria" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              B1 Criteria
            </a>
            <a href="#privacy" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Privacy
            </a>
          </nav>
          <button
            type="button"
            onClick={handleTeacherSignIn}
            disabled={teacherLoading || studentLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <GraduationCap className="h-4 w-4 text-blue-700" />
            {teacherLoading ? 'Signing In...' : 'Teacher Sign In'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 lg:py-14">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
          {/* Left Column: Intro + Student Entry Form */}
          <div className="lg:col-span-6">
            <p className="text-xs font-semibold tracking-wide text-blue-700">
              Cambridge B1 Preliminary Aligned Practice
            </p>
            <h1 className="headline-balance mt-2.5 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Weekly English speaking practice with real audio feedback
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Enter your registered name, Student ID, and class below to access this week&apos;s speaking questions and review your feedback. No student account sign-up required.
            </p>

            {/* Student Entry Form Card */}
            <form
              onSubmit={handleStudentSubmit}
              className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Student Entry
                  </h2>
                  <p className="text-xs text-slate-500">
                    Verified against your teacher&apos;s class list
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadClasses}
                  disabled={loadingClasses}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  title="Refresh class list"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loadingClasses ? 'animate-spin' : ''}`}
                  />
                  Refresh Classes
                </button>
              </div>

              {activeError && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{activeError}</span>
                </div>
              )}

              <div className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="student-full-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Full Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="student-full-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g., Nguyen Minh Anh"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="student-id"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Student ID <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="student-id"
                      type="text"
                      required
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="e.g., B1-2026-001"
                      className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="student-class"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Class <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="student-class"
                      required
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      disabled={loadingClasses || classOptions.length === 0}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      {loadingClasses ? (
                        <option value="">Loading classes...</option>
                      ) : classOptions.length === 0 ? (
                        <option value="">No classes available yet</option>
                      ) : (
                        <>
                          <option value="" disabled>
                            Select your class
                          </option>
                          {classOptions.map((cls) => (
                            <option key={cls} value={cls}>
                              {cls}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {!loadingClasses && classOptions.length === 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Your teacher has not published the class roster yet. Teachers can sign in using the{' '}
                    <span className="font-semibold">Teacher Sign In</span> button above to add students and classes.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    studentLoading ||
                    teacherLoading ||
                    loadingClasses ||
                    classOptions.length === 0
                  }
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Mic className="h-4 w-4" />
                  {studentLoading
                    ? 'Verifying Student Record...'
                    : 'Start Speaking Practice'}
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Studio Image */}
          <div className="lg:col-span-6">
            <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <img
                src="/src/assets/images/hero_speaking_studio_1794839012965.jpg"
                alt="Modern study desk with microphone and English speaking notes"
                referrerPolicy="no-referrer"
                className="h-72 w-full object-cover lg:h-[460px]"
              />
            </div>
          </div>
        </div>

        {/* 3 Core Feature Cards */}
        <section
          id="criteria"
          className="mt-14 grid gap-6 border-t border-slate-200 pt-10 md:grid-cols-3"
        >
          <div id="workflow" className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Mic className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              Browser Voice Studio
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Record each weekly question separately with a strict 5-minute limit, pause/resume controls, and playback review before submitting.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              Three B1 Criteria
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Scored 0–5 on Grammar &amp; Vocabulary, Discourse Management, and audio-evaluated Pronunciation with verbatim transcripts and natural rephrasing.
            </p>
          </div>

          <div id="privacy" className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              Private Session Security
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Each verified Student ID starts an isolated temporary session. You only view your own feedback and recordings, never other classmates&apos; records.
            </p>
          </div>
        </section>

        <div className="mt-8 flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <span>
            Protected by verified temporary student sessions, teacher Google authentication, and role-based Firestore security rules
          </span>
        </div>
      </main>
    </div>
  );
};
