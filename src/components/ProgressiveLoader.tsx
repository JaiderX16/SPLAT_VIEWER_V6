import React from 'react';
import { AlertCircle, Check } from 'lucide-react';
import ProgressRing from '@/components/ProgressRing';

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

  // An error needs its words: a toast above the bottom controls.
  if (isError) {
    return (
      <div className="absolute inset-x-0 bottom-44 md:bottom-24 z-50 flex items-center justify-center pointer-events-none" role="status" aria-live="polite">
        <div className="glass relative isolate flex items-center gap-3 h-12 pl-4 pr-5 rounded-full pointer-events-auto max-w-[90vw]">
          <AlertCircle className="w-4 h-4 text-red-900 dark:text-red-100 shrink-0" />
          <span className="text-sm font-medium truncate text-red-900 dark:text-red-100">{state.message}</span>
        </div>
      </div>
    );
  }

  // The download as a ring, in a glass circle like the menu's: top left (beside the sidebar on desktop).
  // Under the panels (z-30), so a panel opened mid-load covers it instead of the other way round.
  const known = state.percentLabel.endsWith('%');
  const spinning = !isDone && (isProcessing || !known);
  const arc = isDone
    ? 'stroke-emerald-700 dark:stroke-emerald-300'
    : isProcessing
      ? 'stroke-amber-800 dark:stroke-amber-300'
      : 'stroke-sky-700 dark:stroke-sky-300';
  return (
    // pad 6 + 44px circle r22 = 28 (.dock)
    <div
      role="status"
      aria-live="polite"
      aria-label={state.message}
      title={state.message}
      className="absolute left-4 top-4 z-30 glass dock isolate text-neutral-900 dark:text-white md:left-[352px] md:top-6"
    >
      <ProgressRing value={isDone ? 1 : spinning ? 0.25 : state.percent / 100} arcClassName={arc} spinning={spinning}>
        {isDone ? (
          <Check className="h-4 w-4 text-emerald-900 dark:text-emerald-100" />
        ) : (
          // "12.3 MB" when the size is unknown: smaller, to fit the circle
          <span className={known ? undefined : 'text-[9px]'}>{state.percentLabel}</span>
        )}
      </ProgressRing>
    </div>
  );
};

export default ProgressiveLoader;
