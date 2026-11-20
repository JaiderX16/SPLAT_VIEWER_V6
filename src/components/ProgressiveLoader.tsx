import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, CheckCircle2, AlertCircle } from 'lucide-react';

export interface ProgressiveLoadState {
  percent: number;
  percentLabel: string;
  status: 'idle' | 'downloading' | 'processing' | 'done' | 'error';
  message: string;
  sectionCount?: number;
  totalSections?: number;
}

interface ProgressiveLoaderProps {
  state: ProgressiveLoadState;
  /** Small progress ring in the corner (embedded viewers); hidden once loaded. */
  compact?: boolean;
}

const RING_R = 11;
const RING_C = 2 * Math.PI * RING_R;

const ProgressiveLoader: React.FC<ProgressiveLoaderProps> = ({ state, compact = false }) => {
  if (state.status === 'idle') return null;

  const isError = state.status === 'error';
  const isDone = state.status === 'done';
  const isProcessing = state.status === 'processing';

  if (compact) {
    if (isDone) return null;
    return (
      <div
        className="absolute left-3 bottom-3 z-50 glass size-8 rounded-full flex items-center justify-center pointer-events-none"
        role="status"
        aria-live="polite"
        aria-label={`${state.message} ${state.percentLabel}`}
        title={`${state.message} ${state.percentLabel}`}
      >
        {isError ? (
          <AlertCircle className="w-4 h-4 text-red-900 dark:text-red-100" />
        ) : (
          <svg viewBox="0 0 28 28" className={`w-6 h-6 -rotate-90 ${isProcessing ? 'animate-spin' : ''}`} aria-hidden>
            <circle cx="14" cy="14" r={RING_R} fill="none" strokeWidth="2.5" className="stroke-black/[0.10] dark:stroke-white/[0.20]" />
            <circle
              cx="14" cy="14" r={RING_R} fill="none" strokeWidth="2.5" strokeLinecap="round"
              className="stroke-neutral-900 dark:stroke-white transition-[stroke-dashoffset] duration-300"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - Math.max(0.04, state.percent / 100))}
            />
          </svg>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-44 md:bottom-24 z-50 flex items-center justify-center pointer-events-none" role="status" aria-live="polite">
      <div className="glass relative isolate flex items-center gap-3 h-12 pl-4 pr-5 rounded-full pointer-events-auto min-w-[300px] max-w-[90vw]">
        {isError ? (
          <AlertCircle className="w-4 h-4 text-red-900 dark:text-red-100 shrink-0" />
        ) : isDone ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-900 dark:text-emerald-100 shrink-0" />
        ) : isProcessing ? (
          <Loader2 className="w-4 h-4 text-amber-900 dark:text-amber-200 animate-spin shrink-0" />
        ) : (
          <Download className="w-4 h-4 text-sky-900 dark:text-sky-100 shrink-0" />
        )}

        <span className={`text-sm font-medium truncate ${
          isError ? 'text-red-900 dark:text-red-100' : isDone ? 'text-emerald-900 dark:text-emerald-100' : 'text-neutral-900 dark:text-white'
        }`}>
          {state.message}
        </span>

        <div className="flex-1 min-w-[80px] max-w-[140px]">
          <Progress value={state.percent} className="h-1 rounded-full bg-black/[0.06] dark:bg-black/[0.20]" />
        </div>

        <span className="text-xs text-neutral-800 dark:text-white/85 font-mono shrink-0 w-14 text-right tabular-nums">
          {state.percentLabel}
        </span>
      </div>
    </div>
  );
};

export default ProgressiveLoader;
