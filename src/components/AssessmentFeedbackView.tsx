import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  MessageSquareQuote,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { Submission } from '../types';
import { SubmissionAudioPlayer } from './SubmissionAudioPlayer';

interface AssessmentFeedbackViewProps {
  submission: Submission;
  onRetryAssessment?: () => void;
  retrying?: boolean;
}

function getBandLabel(score: number): { label: string; colorClass: string } {
  if (score >= 4.5) return { label: 'Excellent (B1+)', colorClass: 'text-emerald-700' };
  if (score >= 3.5) return { label: 'Good (B1)', colorClass: 'text-blue-700' };
  if (score >= 2.5) return { label: 'Satisfactory (B1)', colorClass: 'text-slate-700' };
  if (score >= 1.5) return { label: 'Developing', colorClass: 'text-amber-700' };
  return { label: 'Needs Support', colorClass: 'text-red-700' };
}

export const AssessmentFeedbackView: React.FC<AssessmentFeedbackViewProps> = ({
  submission,
  onRetryAssessment,
  retrying = false,
}) => {
  if (submission.processingStatus === 'processing') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-6">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-700 border-t-transparent" />
          <div>
            <h4 className="text-sm font-semibold text-slate-900">
              AI Assessment in Progress
            </h4>
            <p className="mt-0.5 text-sm text-slate-600">
              Transcribing your recording and evaluating Grammar & Vocabulary, Discourse Management, and Pronunciation...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (submission.processingStatus === 'failed') {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <h4 className="text-sm font-semibold text-red-900">
              AI Assessment Failed
            </h4>
            <p className="mt-1 text-sm text-red-800">
              {submission.errorMessage ||
                'We saved your recording safely, but the AI service could not complete the assessment right now.'}
            </p>
          </div>
        </div>
        <SubmissionAudioPlayer submission={submission} />
        {onRetryAssessment && (
          <button
            type="button"
            onClick={onRetryAssessment}
            disabled={retrying}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying Assessment...' : 'Retry AI Assessment'}
          </button>
        )}
      </div>
    );
  }

  if (submission.processingStatus === 'needs_rerecording') {
    return (
      <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h4 className="text-sm font-semibold text-amber-950">
              Re-recording Required
            </h4>
            <p className="mt-1 text-sm text-amber-900">
              {submission.overallComment ||
                submission.errorMessage ||
                'The recording was too quiet, unclear, or too short to evaluate reliably. Please record your answer again.'}
            </p>
          </div>
        </div>
        <SubmissionAudioPlayer submission={submission} />
      </div>
    );
  }

  const assessment = submission.assessment;
  const overall = submission.overallScore ?? assessment?.overall_score ?? 0;
  const band = getBandLabel(overall);

  if (!assessment) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Assessment details are not available yet.
      </div>
    );
  }

  const criteria = [
    {
      title: 'B. Grammar & Vocabulary',
      score: assessment.grammar_vocabulary.score,
      feedback: assessment.grammar_vocabulary.feedback,
      strengths: assessment.grammar_vocabulary.strengths,
      improvements: assessment.grammar_vocabulary.improvements,
      evidence: [],
    },
    {
      title: 'C. Discourse Management',
      score: assessment.discourse_management.score,
      feedback: assessment.discourse_management.feedback,
      strengths: assessment.discourse_management.strengths,
      improvements: assessment.discourse_management.improvements,
      evidence: [],
    },
    {
      title: 'D. Pronunciation (Audio-Evaluated)',
      score: assessment.pronunciation.score,
      feedback: assessment.pronunciation.feedback,
      strengths: assessment.pronunciation.strengths,
      improvements: assessment.pronunciation.improvements,
      evidence: assessment.pronunciation.evidence || [],
    },
  ];

  return (
    <div className="space-y-6">
      {/* A. Overall Score & Audio */}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-12 md:items-center">
        <div className="md:col-span-5">
          <p className="text-xs font-medium text-slate-500">
            A. Overall Practice Score
          </p>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="font-mono text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
              {overall.toFixed(1)}
            </span>
            <span className="font-mono text-lg text-slate-400 tabular-nums">/ 5.0</span>
            <span className={`text-sm font-semibold ${band.colorClass}`}>
              · {band.label}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Internal practice indicator aligned with selected B1 Preliminary speaking criteria (average of 3 criteria; not an official Cambridge score).
          </p>
        </div>

        <div className="md:col-span-7">
          <SubmissionAudioPlayer submission={submission} />
        </div>
      </div>

      {/* Speech Transcript */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-slate-500" />
          <h3>Speech Transcript (Verbatim)</h3>
        </div>
        <p className="mt-2.5 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 border border-slate-100">
          {submission.transcript || 'No transcript available.'}
        </p>
      </div>

      {/* B, C, D. Three Criteria */}
      <div className="grid gap-4 lg:grid-cols-3">
        {criteria.map((c) => (
          <div
            key={c.title}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
          >
            <div>
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
                <h4 className="text-sm font-semibold text-slate-900">{c.title}</h4>
                <span className="font-mono text-lg font-bold text-blue-700 tabular-nums">
                  {c.score}/5
                </span>
              </div>

              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-700"
                  style={{ width: `${(c.score / 5) * 100}%` }}
                />
              </div>

              <p className="mt-3 text-sm leading-relaxed text-slate-700">
                {c.feedback}
              </p>

              {c.strengths.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-emerald-700">Strengths</p>
                  <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-600">
                    {c.strengths.map((s, i) => (
                      <li key={i}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {c.improvements.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-amber-700">Focus Next</p>
                  <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-600">
                    {c.improvements.map((s, i) => (
                      <li key={i}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {c.evidence.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-700">
                    Observed Audio Features
                  </p>
                  <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-600">
                    {c.evidence.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* E & F. What You Did Well + Areas to Improve */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h4>E. What You Did Well</h4>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {submission.whatYouDidWell.length > 0 ? (
              submission.whatYouDidWell.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                  <span>{item}</span>
                </li>
              ))
            ) : (
              <li className="text-slate-500">Good effort completing this response.</li>
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <h4>F. Areas to Improve</h4>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {submission.areasToImprove.length > 0 ? (
              submission.areasToImprove.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                  <span>{item}</span>
                </li>
              ))
            ) : (
              <li className="text-slate-500">Keep practising consistently each week.</li>
            )}
          </ul>
        </div>
      </div>

      {/* G. Original vs Improved Expressions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-slate-900">
          G. Original Expressions vs Improved Expressions
        </h4>
        {submission.expressionCorrections.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No major corrections needed.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Student's original expression</th>
                  <th className="py-2.5 pr-4">Improved expression</th>
                  <th className="py-2.5">Why it sounds better</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {submission.expressionCorrections.map((row, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-3 pr-4 text-slate-700">"{row.original}"</td>
                    <td className="py-3 pr-4 font-medium text-emerald-800">
                      "{row.improved}"
                    </td>
                    <td className="py-3 text-xs leading-relaxed text-slate-600">
                      {row.explanation || 'More natural B1 phrasing.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* H. Overall Comment */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <MessageSquareQuote className="h-4 w-4 text-blue-700" />
          <h4>H. Overall Comment & Next Step</h4>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {submission.overallComment}
        </p>
      </div>
    </div>
  );
};
