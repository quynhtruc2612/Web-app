import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Mic,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';

export const AuthScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled. Please click Continue with Google when ready.');
      } else if (err?.code === 'auth/popup-blocked') {
        setError(
          'Your browser blocked the sign-in popup. Please allow popups for this site and try again.'
        );
      } else {
        setError(err?.message || 'Unable to sign in right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
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
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-stretch">
          <div className="flex flex-col justify-center lg:col-span-6">
            <p className="text-xs font-semibold tracking-wide text-blue-700">
              Cambridge B1 Preliminary Aligned Practice
            </p>
            <h1 className="headline-balance mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Weekly English speaking practice with real audio feedback
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
              Record up to 5-minute spoken answers directly in your browser, receive structured feedback across three B1 criteria, and track improvement week by week.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="inline-flex min-h-[48px] items-center justify-center gap-3 rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                {loading ? 'Connecting to Google...' : 'Continue with Google'}
              </button>
              <span className="text-xs text-slate-500">
                Role-verified access for teachers and enrolled students
              </span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <img
                src="/src/assets/images/hero_speaking_studio_1794839012965.jpg"
                alt="Modern study desk with microphone and English speaking notes"
                referrerPolicy="no-referrer"
                className="h-72 w-full object-cover lg:h-full"
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
              Scored 0–5 on Grammar & Vocabulary, Discourse Management, and audio-evaluated Pronunciation with verbatim transcripts and natural rephrasing.
            </p>
          </div>

          <div id="privacy" className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              Private Progress Tracking
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Students view only their own recordings and weekly progress charts, while teachers monitor class completion and review audio submissions.
            </p>
          </div>
        </section>

        <div className="mt-8 flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <span>
            Authenticated with Firebase Auth · Protected by role-based Firestore security rules
          </span>
        </div>
      </main>
    </div>
  );
};
