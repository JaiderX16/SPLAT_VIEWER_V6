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
    <div className="absolute inset-x-0 bottom-6 z-50 flex items-center justify-center pointer-events-none">
      <div className="flex items-center gap-3 h-14 px-5 bg-black/80 backdrop-blur-md border border-white/10 rounded-full shadow-2xl pointer-events-auto min-w-[360px] max-w-[90vw]">
        {isError ? (
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
        ) : isDone ? (
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
        ) : isProcessing ? (
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
        ) : (
          <Download className="w-4 h-4 text-blue-400 animate-bounce shrink-0" />
        )}

        <span className={`text-sm font-medium truncate ${
          isError ? 'text-red-300' : isDone ? 'text-green-300' : 'text-white'
        }`}>
          {state.message}
        </span>

        <div className="flex-1 min-w-[80px] max-w-[140px]">
          <Progress value={state.percent} className="h-1.5 bg-white/10" />
        </div>

        <span className="text-xs text-white/60 font-mono shrink-0 w-12 text-right">
          {state.percentLabel}
        </span>
      </div>
    </div>
  );
};

export default ProgressiveLoader;
