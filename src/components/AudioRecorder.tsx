import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Lock,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import { formatDuration } from '../lib/stats';
import { ConfirmDialog } from './ConfirmDialog';

const MAX_RECORDING_SECONDS = 300; // Strict 5-minute limit

interface AudioRecorderProps {
  disabled?: boolean;
  disabledReason?: string;
  isSubmitting?: boolean;
  onSubmitRecording: (payload: {
    blob: Blob;
    mimeType: string;
    durationSeconds: number;
  }) => Promise<void>;
}

function selectSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  disabled = false,
  disabledReason = '',
  isSubmitting = false,
  onSubmitRecording,
}) => {
  const [recorderState, setRecorderState] = useState<
    'idle' | 'requesting' | 'recording' | 'paused' | 'recorded'
  >('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [limitReachedNotice, setLimitReachedNotice] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState('audio/webm');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [supportsPause, setSupportsPause] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const accumulatedMsRef = useRef<number>(0);
  const activeStartMsRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const stoppedByLimitRef = useRef(false);

  const isSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';

  const cleanupRecordingResources = () => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setAudioLevel(0);
  };

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const computeAccurateElapsedSeconds = () => {
    const activeMs =
      activeStartMsRef.current !== null
        ? Math.max(0, performance.now() - activeStartMsRef.current)
        : 0;
    return Math.min(
      MAX_RECORDING_SECONDS,
      Math.floor((accumulatedMsRef.current + activeMs) / 1000)
    );
  };

  const stopRecordingInternal = (hitLimit = false) => {
    stoppedByLimitRef.current = hitLimit;
    if (activeStartMsRef.current !== null) {
      accumulatedMsRef.current += Math.max(
        0,
        performance.now() - activeStartMsRef.current
      );
      activeStartMsRef.current = null;
    }
    const finalSeconds = Math.min(
      MAX_RECORDING_SECONDS,
      Math.max(1, Math.round(accumulatedMsRef.current / 1000))
    );
    setElapsedSeconds(finalSeconds);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        cleanupRecordingResources();
      }
    } else {
      cleanupRecordingResources();
    }
  };

  const startTimerLoop = () => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
    }
    timerIntervalRef.current = window.setInterval(() => {
      const secs = computeAccurateElapsedSeconds();
      setElapsedSeconds(secs);
      if (secs >= MAX_RECORDING_SECONDS) {
        setLimitReachedNotice(true);
        stopRecordingInternal(true);
      }
    }, 200);
  };

  const startAnalyser = (stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!audioContextRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 90) * 100)));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // Visualizer is optional; recording still proceeds
    }
  };

  const handleStartRecording = async () => {
    if (disabled || !isSupported) return;
    setMicError(null);
    setLimitReachedNotice(false);
    setRecorderState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const preferredMime = selectSupportedMimeType();
      const options: MediaRecorderOptions = preferredMime
        ? { mimeType: preferredMime, audioBitsPerSecond: 32000 }
        : { audioBitsPerSecond: 32000 };

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;
      setSupportsPause(typeof recorder.pause === 'function');
      chunksRef.current = [];
      accumulatedMsRef.current = 0;
      activeStartMsRef.current = performance.now();
      stoppedByLimitRef.current = false;
      setElapsedSeconds(0);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || preferredMime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        cleanupRecordingResources();

        if (blob.size < 250) {
          setMicError(
            'The recorded audio was empty. Please verify your microphone input and try again.'
          );
          setRecorderState('idle');
          return;
        }

        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedMimeType(mime);
        setPreviewUrl(url);
        setPlaybackTime(0);
        setIsPlayingPreview(false);
        setRecorderState('recorded');
      };

      recorder.onerror = () => {
        cleanupRecordingResources();
        setMicError('Recording failed unexpectedly. Please check your microphone and retry.');
        setRecorderState('idle');
      };

      recorder.start(1000);
      setRecorderState('recording');
      startTimerLoop();
      startAnalyser(stream);
    } catch (err: any) {
      cleanupRecordingResources();
      setRecorderState('idle');
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setMicError(
          'Microphone access was denied. Please allow microphone permissions in your browser settings and try again.'
        );
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        setMicError(
          'No microphone was detected on this device. Please connect a microphone and retry.'
        );
      } else {
        setMicError(
          'Unable to access your microphone. Make sure no other app is using it and try again.'
        );
      }
    }
  };

  const handlePauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    try {
      recorder.pause();
      if (activeStartMsRef.current !== null) {
        accumulatedMsRef.current += Math.max(
          0,
          performance.now() - activeStartMsRef.current
        );
        activeStartMsRef.current = null;
      }
      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setElapsedSeconds(computeAccurateElapsedSeconds());
      setRecorderState('paused');
    } catch {
      setMicError('Pause is not supported by this browser. Use Stop when finished.');
    }
  };

  const handleResumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    try {
      recorder.resume();
      activeStartMsRef.current = performance.now();
      setRecorderState('recording');
      startTimerLoop();
    } catch {
      setMicError('Unable to resume recording.');
    }
  };

  const handleDiscardRecording = () => {
    if (audioElRef.current) {
      audioElRef.current.pause();
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setRecordedBlob(null);
    setElapsedSeconds(0);
    setPlaybackTime(0);
    setIsPlayingPreview(false);
    setLimitReachedNotice(false);
    setRecorderState('idle');
  };

  const togglePreviewPlayback = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
      setIsPlayingPreview(true);
    } else {
      el.pause();
      setIsPlayingPreview(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!recordedBlob || isSubmitting) return;
    setConfirmOpen(false);
    await onSubmitRecording({
      blob: recordedBlob,
      mimeType: recordedMimeType,
      durationSeconds: Math.max(1, Math.min(MAX_RECORDING_SECONDS, elapsedSeconds)),
    });
  };

  if (!isSupported) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Browser Recording Unsupported</p>
            <p className="mt-1 text-amber-800">
              Your current browser does not support in-browser audio recording. Please open this page in Chrome, Safari, Edge, or Firefox.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <div className="flex items-center gap-2.5">
          <Lock className="h-4 w-4 shrink-0 text-slate-500" />
          <span>{disabledReason || 'Recording is locked for this assignment.'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
      {micError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{micError}</span>
        </div>
      )}

      {limitReachedNotice && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Maximum recording time of 05:00 was reached and your recording stopped automatically. Listen to your answer below before submitting.
          </span>
        </div>
      )}

      {/* IDLE / REQUESTING */}
      {(recorderState === 'idle' || recorderState === 'requesting') && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900">
              {recorderState === 'requesting'
                ? 'Requesting microphone permission...'
                : 'Ready to record your answer'}
            </p>
            <p className="text-xs text-slate-500">
              Maximum duration: 05:00 per question · You can review before submitting
            </p>
          </div>
          <button
            type="button"
            onClick={handleStartRecording}
            disabled={recorderState === 'requesting' || isSubmitting}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Mic className="h-4 w-4" />
            {recorderState === 'requesting' ? 'Allow Microphone...' : 'Start Recording'}
          </button>
        </div>
      )}

      {/* RECORDING / PAUSED */}
      {(recorderState === 'recording' || recorderState === 'paused') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {recorderState === 'recording' ? (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-red-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse" />
                  Recording Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700">
                  <Pause className="h-4 w-4" />
                  Recording Paused
                </span>
              )}
              <span className="text-xs text-slate-500">Max 05:00</span>
            </div>

            <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {formatDuration(elapsedSeconds)}{' '}
              <span className="text-sm font-normal text-slate-400">/ 05:00</span>
            </div>
          </div>

          {/* Live mic input bar */}
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full transition-all duration-100 ${
                  recorderState === 'recording' ? 'bg-blue-600' : 'bg-amber-500'
                }`}
                style={{ width: `${recorderState === 'recording' ? Math.max(6, audioLevel) : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500 tabular-nums">
              <span>Microphone input level</span>
              <span>{Math.max(0, MAX_RECORDING_SECONDS - elapsedSeconds)}s remaining</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {supportsPause && (
              <button
                type="button"
                onClick={
                  recorderState === 'recording'
                    ? handlePauseRecording
                    : handleResumeRecording
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 whitespace-nowrap shrink-0"
              >
                {recorderState === 'recording' ? (
                  <>
                    <Pause className="h-4 w-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Resume
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => stopRecordingInternal(false)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 whitespace-nowrap shrink-0"
            >
              <Square className="h-4 w-4 fill-current" />
              Stop Recording
            </button>
          </div>
        </div>
      )}

      {/* RECORDED PREVIEW */}
      {recorderState === 'recorded' && previewUrl && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Review Your Recording
              </p>
              <p className="text-xs text-slate-500 tabular-nums">
                Duration: {formatDuration(elapsedSeconds)} · Not yet submitted
              </p>
            </div>
            <button
              type="button"
              onClick={handleDiscardRecording}
              disabled={isSubmitting}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete & Re-record
            </button>
          </div>

          <audio
            ref={audioElRef}
            src={previewUrl}
            onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)}
            onEnded={() => setIsPlayingPreview(false)}
            className="hidden"
          />

          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={togglePreviewPlayback}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700"
              aria-label={isPlayingPreview ? 'Pause playback' : 'Play recording'}
            >
              {isPlayingPreview ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4 ml-0.5" />
              )}
            </button>

            <div className="flex-1 space-y-1">
              <input
                type="range"
                min={0}
                max={Math.max(1, elapsedSeconds)}
                step={0.1}
                value={Math.min(playbackTime, Math.max(1, elapsedSeconds))}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setPlaybackTime(t);
                  if (audioElRef.current) {
                    audioElRef.current.currentTime = t;
                  }
                }}
                aria-label="Seek recording playback"
                className="h-1.5 w-full cursor-pointer accent-blue-700"
              />
              <div className="flex justify-between font-mono text-xs text-slate-500 tabular-nums">
                <span>{formatDuration(playbackTime)}</span>
                <span>{formatDuration(elapsedSeconds)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleDiscardRecording}
              disabled={isSubmitting}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-4 w-4" />
              Record Again
            </button>

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={isSubmitting}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="h-4 w-4" />
              {isSubmitting ? 'Submitting...' : 'Submit Answer'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-slate-200/80 pt-3 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>
          Recordings are stored privately for your account and accessible only to you and your teacher.
        </span>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit Speaking Answer"
        message="Are you ready to submit your answer for AI assessment? Once submitted, your recording becomes your official response for this question."
        confirmLabel="Yes, Submit Answer"
        cancelLabel="Review Again"
        tone="primary"
        loading={isSubmitting}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};
