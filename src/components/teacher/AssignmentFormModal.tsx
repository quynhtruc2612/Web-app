import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { makeSafeId } from '../../lib/db';
import type { Assignment, AssignmentStatus, SpeakingQuestion } from '../../types';

interface AssignmentFormModalProps {
  open: boolean;
  editingAssignment: Assignment | null;
  suggestedWeekNumber: number;
  otherOpenAssignment: Assignment | null;
  onClose: () => void;
  onSave: (payload: {
    weekNumber: number;
    title: string;
    topic: string;
    instructions: string;
    questions: SpeakingQuestion[];
    deadline: string;
    status: AssignmentStatus;
    lockOtherOpenWeekId?: string;
  }) => Promise<void>;
}

export const AssignmentFormModal: React.FC<AssignmentFormModalProps> = ({
  open,
  editingAssignment,
  suggestedWeekNumber,
  otherOpenAssignment,
  onClose,
  onSave,
}) => {
  const [weekNumber, setWeekNumber] = useState(suggestedWeekNumber);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [instructions, setInstructions] = useState(
    'Answer each speaking question clearly. Try to speak for 1 to 3 minutes per question (maximum 5 minutes), give reasons, and include personal examples.'
  );
  const [deadline, setDeadline] = useState('');
  const [questions, setQuestions] = useState<SpeakingQuestion[]>([
    { questionId: makeSafeId('q1'), order: 1, prompt: '', tips: '' },
  ]);
  const [lockOtherOnPublish, setLockOtherOnPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingAssignment) {
      setWeekNumber(editingAssignment.weekNumber);
      setTitle(editingAssignment.title);
      setTopic(editingAssignment.topic);
      setInstructions(editingAssignment.instructions);
      setDeadline(editingAssignment.deadline || '');
      setQuestions(
        editingAssignment.questions.length > 0
          ? editingAssignment.questions.map((q, idx) => ({
              ...q,
              order: idx + 1,
            }))
          : [{ questionId: makeSafeId('q1'), order: 1, prompt: '', tips: '' }]
      );
    } else {
      setWeekNumber(suggestedWeekNumber);
      setTitle('');
      setTopic('');
      setInstructions(
        'Answer each speaking question clearly. Try to speak for 1 to 3 minutes per question (maximum 5 minutes), give reasons, and include personal examples.'
      );
      setDeadline('');
      setQuestions([
        { questionId: makeSafeId('q1'), order: 1, prompt: '', tips: '' },
      ]);
    }
  }, [open, editingAssignment, suggestedWeekNumber]);

  if (!open) return null;

  const handleAddQuestion = () => {
    if (questions.length >= 20) return;
    setQuestions((prev) => [
      ...prev,
      {
        questionId: makeSafeId(`q${prev.length + 1}`),
        order: prev.length + 1,
        prompt: '',
        tips: '',
      },
    ]);
  };

  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    setQuestions((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[target];
      copy[target] = temp;
      return copy.map((q, i) => ({ ...q, order: i + 1 }));
    });
  };

  const handleRemoveQuestion = (index: number) => {
    if (questions.length <= 1) return;
    setQuestions((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((q, i) => ({ ...q, order: i + 1 }))
    );
  };

  const handleSubmit = async (targetStatus: AssignmentStatus) => {
    setError(null);
    if (!title.trim()) {
      setError('Please enter an assignment title.');
      return;
    }
    if (!topic.trim()) {
      setError('Please enter a speaking topic.');
      return;
    }
    const validQuestions = questions.filter((q) => q.prompt.trim().length > 0);
    if (validQuestions.length === 0) {
      setError('Please add at least one speaking question.');
      return;
    }

    setSaving(true);
    try {
      const shouldLockOther =
        targetStatus === 'open' &&
        otherOpenAssignment &&
        otherOpenAssignment.assignmentId !== editingAssignment?.assignmentId &&
        lockOtherOnPublish;

      await onSave({
        weekNumber,
        title: title.trim(),
        topic: topic.trim(),
        instructions: instructions.trim(),
        questions: validQuestions.map((q, idx) => ({
          ...q,
          order: idx + 1,
          prompt: q.prompt.trim(),
          tips: (q.tips || '').trim(),
        })),
        deadline: deadline.trim(),
        status: targetStatus,
        lockOtherOpenWeekId: shouldLockOther
          ? otherOpenAssignment.assignmentId
          : undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to save assignment.');
    } finally {
      setSaving(false);
    }
  };

  const hasConflictOpenWeek =
    otherOpenAssignment &&
    otherOpenAssignment.assignmentId !== editingAssignment?.assignmentId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignment-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2
              id="assignment-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {editingAssignment
                ? `Edit Week ${String(editingAssignment.weekNumber).padStart(2, '0')}`
                : 'Create New Weekly Assignment'}
            </h2>
            <p className="text-xs text-slate-500">
              Each question receives its own unique ID and separate student audio submission.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Week Number
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={weekNumber}
                onChange={(e) => setWeekNumber(Number(e.target.value) || 1)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-slate-700">
                Assignment Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Week 01: Everyday Life & Free Time"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Speaking Topic
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Hobbies, Travel & Daily Routines"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Submission Deadline (Optional)
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Instructions for Students
            </label>
            <textarea
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>

          {/* Speaking Questions */}
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Speaking Questions ({questions.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Add, edit, or reorder questions. Existing submitted records keep a snapshot of the original question.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddQuestion}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Question
              </button>
            </div>

            <div className="space-y-3">
              {questions.map((q, index) => (
                <div
                  key={q.questionId}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-700">
                      Question {index + 1} · ID: {q.questionId}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveQuestion(index, -1)}
                        disabled={index === 0}
                        className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                        title="Move question up"
                        aria-label="Move question up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveQuestion(index, 1)}
                        disabled={index === questions.length - 1}
                        className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                        title="Move question down"
                        aria-label="Move question down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveQuestion(index)}
                        disabled={questions.length <= 1}
                        className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-30"
                        title="Delete question"
                        aria-label="Delete question"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={2}
                    value={q.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuestions((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, prompt: val } : item
                        )
                      );
                    }}
                    placeholder="Enter the B1 speaking prompt (e.g., Tell me about a holiday you enjoyed recently. Where did you go and what did you do?)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />

                  <input
                    type="text"
                    value={q.tips || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuestions((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, tips: val } : item
                        )
                      );
                    }}
                    placeholder="Optional student tip (e.g., Mention who you went with and why you liked it)"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>
              ))}
            </div>
          </div>

          {hasConflictOpenWeek && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
              <p className="font-semibold">
                Week {String(otherOpenAssignment.weekNumber).padStart(2, '0')} ({otherOpenAssignment.title}) is currently Open.
              </p>
              <label className="mt-2 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lockOtherOnPublish}
                  onChange={(e) => setLockOtherOnPublish(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 accent-amber-700"
                />
                <span>
                  Automatically lock Week {String(otherOpenAssignment.weekNumber).padStart(2, '0')} when publishing this week (existing submissions remain preserved)
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={saving}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('open')}
              disabled={saving}
              className="min-h-[40px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {saving ? 'Publishing...' : 'Publish & Open Week'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
