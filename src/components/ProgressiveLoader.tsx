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
  const isDownloading = state.status === 'downloading';

  return (
    <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col items-center justify-end p-6 pointer-events-none">
      <div className="w-full max-w-md bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl p-5 shadow-2xl pointer-events-auto">
        <div className="flex items-center gap-3 mb-3">
          {isError ? (
            <AlertCircle className="w-5 h-5 text-red-400 animate-pulse" />
          ) : isDone ? (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          ) : isProcessing ? (
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
          ) : (
            <Download className="w-5 h-5 text-blue-400 animate-bounce" />
          )}
          <span className={`text-sm font-semibold ${
            isError ? 'text-red-300' : isDone ? 'text-green-300' : 'text-white'
          }`}>
            {state.message}
          </span>
        </div>

        <div className="relative">
          <Progress
            value={state.percent}
            className="h-3 bg-white/10"
          />
          <div className="absolute right-0 -top-5 text-xs text-white/70 font-mono">
            {state.percentLabel}
          </div>
        </div>

        {state.sectionCount !== undefined && state.totalSections !== undefined && (
          <div className="mt-2 text-xs text-white/50 text-center">
            Section {state.sectionCount} of {state.totalSections}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between text-xs text-white/40">
          <span>{isDownloading ? 'Downloading chunks...' : isProcessing ? 'Building splat mesh...' : isDone ? 'Ready to view' : ''}</span>
          <span>{state.percent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
};

export default ProgressiveLoader;
