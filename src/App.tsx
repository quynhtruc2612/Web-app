import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { StudentDashboard } from './components/student/StudentDashboard';
import { TeacherDashboard } from './components/teacher/TeacherDashboard';
import { ensureUserProfile } from './lib/db';
import { auth } from './lib/firebase';
import type { UserProfile } from './types';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const loadProfile = async (user: User) => {
    setBootError(null);
    try {
      const prof = await ensureUserProfile(user);
      setProfile(prof);
    } catch (err: any) {
      setBootError(
        err instanceof Error
          ? err.message
          : 'Unable to load your account profile from Firestore.'
      );
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await loadProfile(user);
      } else {
        setProfile(null);
        setBootError(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-700 border-t-transparent" />
          <span>Loading B1 Speaking Practice...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return <AuthScreen />;
  }

  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <h1 className="text-base font-bold text-slate-900">
                Account Connection Issue
              </h1>
              <p className="mt-1.5 text-sm text-slate-600">{bootError}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={() => loadProfile(firebaseUser)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-700 border-t-transparent" />
          <span>Preparing your workspace...</span>
        </div>
      </div>
    );
  }

  if (profile.role === 'teacher') {
    return <TeacherDashboard profile={profile} />;
  }

  return (
    <StudentDashboard
      profile={profile}
      onProfileUpdated={(updated) => setProfile(updated)}
    />
  );
}
