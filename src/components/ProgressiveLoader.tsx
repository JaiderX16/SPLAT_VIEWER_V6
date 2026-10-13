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
}

export const ProgressiveLoader: React.FC<ProgressiveLoaderProps> = ({ state }) => {
  if (state.status === 'idle') return null;

  const isError = state.status === 'error';
  const isDone = state.status === 'done';
  const isProcessing = state.status === 'processing';

  return (
    <div className="absolute inset-x-0 bottom-44 md:bottom-24 z-50 flex items-center justify-center pointer-events-none" role="status" aria-live="polite">
      <div className="glass flex items-center gap-3 h-12 pl-4 pr-5 rounded-full pointer-events-auto min-w-[300px] max-w-[90vw]">
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
