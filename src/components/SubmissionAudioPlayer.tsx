import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Pause, Play, Volume2 } from 'lucide-react';
import { resolveSubmissionAudioUrl } from '../lib/audioStorage';
import { formatDuration } from '../lib/stats';
import type { Submission } from '../types';

interface SubmissionAudioPlayerProps {
  submission: Submission;
}

export const SubmissionAudioPlayer: React.FC<SubmissionAudioPlayerProps> = ({
  submission,
}) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [shouldRevoke, setShouldRevoke] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(submission.recordingDuration || 0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl && shouldRevoke) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl, shouldRevoke]);

  // Reset if submission changes
  useEffect(() => {
    setAudioUrl((prev) => {
      if (prev && shouldRevoke) URL.revokeObjectURL(prev);
      return null;
    });
    setShouldRevoke(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(submission.recordingDuration || 0);
    setError(null);
  }, [submission.submissionId, submission.submittedAt]);

  const loadAndPlay = async () => {
    if (audioUrl && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await resolveSubmissionAudioUrl(submission);
      setAudioUrl(res.url);
      setShouldRevoke(res.shouldRevoke);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current
            .play()
            .then(() => setIsPlaying(true))
            .catch(() => {});
        }
      }, 60);
    } catch (err: any) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load audio recording.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (submission.audioStorageType === 'none') {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        No audio recording attached.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            if (
              Number.isFinite(e.currentTarget.duration) &&
              e.currentTarget.duration > 0
            ) {
              setDuration(e.currentTarget.duration);
            }
          }}
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={loadAndPlay}
          disabled={loading}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:opacity-50"
          aria-label={isPlaying ? 'Pause student recording' : 'Play student recording'}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <Volume2 className="h-3.5 w-3.5 text-slate-500" />
              {audioUrl ? 'Recorded Response' : 'Click play to load audio'}
            </span>
            <span className="font-mono text-slate-500 tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            disabled={!audioUrl}
            value={Math.min(currentTime, Math.max(1, duration))}
            onChange={(e) => {
              const t = Number(e.target.value);
              setCurrentTime(t);
              if (audioRef.current) {
                audioRef.current.currentTime = t;
              }
            }}
            aria-label="Audio playback position"
            className="h-1.5 w-full cursor-pointer accent-blue-700 disabled:cursor-default disabled:opacity-50"
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </span>
          <button
            type="button"
            onClick={loadAndPlay}
            className="font-semibold underline hover:no-underline whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};
