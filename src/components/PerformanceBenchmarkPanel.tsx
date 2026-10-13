import type { ReactNode } from 'react';
import { Activity, Cpu, Gauge, Layers3, MonitorSmartphone, Workflow, Zap } from 'lucide-react';
import type { BenchmarkScore, BenchmarkStatus } from '@/lib/performanceBenchmark';
import { formatCompactNumber } from '@/lib/performanceBenchmark';

export interface PerformanceBenchmarkInfo {
  fps: number | null;
  estimatedVramMB: number | null;
  jsHeapMB: number | null;
  totalSplats: number;
  activeSplats: number;
  drawCalls: number | null;
  sortTimeMs: number;
  devicePixelRatio: number;
  renderPixelRatio: number | null;
  renderSize: string;
  webgl2: boolean;
  webgpu: boolean;
  backend: 'webgpu' | 'webgl';
  score: BenchmarkScore;
}

interface PerformanceBenchmarkPanelProps {
  info: PerformanceBenchmarkInfo | null;
  visible: boolean;
}

interface MetricRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  status: BenchmarkStatus;
}

const statusDotClass: Record<BenchmarkStatus, string> = {
  ideal: 'bg-emerald-600 shadow-[0_0_0_3px_rgba(16,185,129,0.18)] dark:bg-emerald-300 dark:shadow-[0_0_10px_rgba(110,231,183,0.55)]',
  safe: 'bg-emerald-600 dark:bg-emerald-300',
  ok: 'bg-sky-600 dark:bg-sky-300',
  warn: 'bg-amber-700 dark:bg-amber-300',
  danger: 'bg-red-600 dark:bg-red-200',
  unknown: 'bg-neutral-400 dark:bg-white/40',
};

const statusTextClass: Record<BenchmarkStatus, string> = {
  ideal: 'text-emerald-800 dark:text-emerald-100',
  safe: 'text-emerald-800 dark:text-emerald-100',
  ok: 'text-sky-800 dark:text-sky-100',
  warn: 'text-amber-800 dark:text-amber-200',
  danger: 'text-red-800 dark:text-red-100',
  unknown: 'text-[#5a5a5f] dark:text-white/85',
};

function MetricRow({ icon, label, value, detail, status }: MetricRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-black/[0.20] text-neutral-600 dark:text-white/85">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5a5a5f] dark:text-white/85">
            {label}
          </div>
          <div className={`truncate text-xs ${statusTextClass[status]}`}>{detail}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 font-mono text-sm text-neutral-900 dark:text-white">
        <span className={`h-2 w-2 rounded-full ${statusDotClass[status]}`} />
        {value}
      </div>
    </div>
  );
}

function formatFps(fps: number | null): string {
  return fps === null ? 'N/A' : String(Math.round(fps));
}

function formatMB(value: number | null): string {
  return value === null ? 'N/A' : `${Math.round(value)} MB`;
}

function formatDrawCalls(value: number | null): string {
  return value === null ? 'N/A' : value.toLocaleString();
}

function formatRenderRatio(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(1)}x`;
}

export default function PerformanceBenchmarkPanel({ info, visible }: PerformanceBenchmarkPanelProps) {
  if (!visible) return null;

  return (
    <section
      aria-label="Benchmark de rendimiento Web 3D 2026"
      className="absolute left-3 right-[5.5rem] top-4 z-[240] glass panel text-neutral-900 dark:text-white md:left-auto md:top-6 md:right-[6.5rem] md:w-[360px]"
    >
      <div className="mb-3 flex items-start justify-between gap-3 px-2 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-800 dark:text-sky-100" />
            <h2 className="truncate text-sm font-semibold">Benchmark 2026</h2>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[#5a5a5f] dark:text-white/85">
            iPhone 13/14, A54/A55, Pixel 7a
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border border-black/[0.06] dark:border-white/[0.14] bg-black/[0.05] dark:bg-black/[0.20] px-3 py-1 text-[11px] font-semibold ${statusTextClass[info?.score.overall.status ?? 'unknown']}`}
        >
          {info?.score.overall.label ?? 'Sin escena'}
        </span>
      </div>

      {info ? (
        <div className="panel-inner bg-black/[0.04] dark:bg-black/[0.20] p-2 space-y-2.5">
          <MetricRow
            icon={<Zap className="h-3.5 w-3.5" />}
            label="FPS"
            value={formatFps(info.fps)}
            detail={info.score.fps.label}
            status={info.score.fps.status}
          />
          <MetricRow
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="VRAM est."
            value={formatMB(info.estimatedVramMB)}
            detail={info.score.vram.label}
            status={info.score.vram.status}
          />
          <MetricRow
            icon={<Layers3 className="h-3.5 w-3.5" />}
            label="Splats activos"
            value={formatCompactNumber(info.activeSplats)}
            detail={`${formatCompactNumber(info.totalSplats)} totales`}
            status={info.score.splats.status}
          />
          <MetricRow
            icon={<Workflow className="h-3.5 w-3.5" />}
            label="Draw calls"
            value={formatDrawCalls(info.drawCalls)}
            detail={info.score.drawCalls.label}
            status={info.score.drawCalls.status}
          />
          <MetricRow
            icon={<MonitorSmartphone className="h-3.5 w-3.5" />}
            label="DPR render"
            value={`${info.devicePixelRatio.toFixed(1)} -> ${formatRenderRatio(info.renderPixelRatio)}`}
            detail={`${info.renderSize} interno`}
            status={info.score.resolution.status}
          />

          <div className="grid grid-cols-3 gap-2 border-t border-black/[0.06] dark:border-white/[0.14] pt-2 text-[11px]">
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5">
              <div className="text-[#5a5a5f] dark:text-white/85">Sort</div>
              <div className="font-mono text-neutral-700 dark:text-white">{info.sortTimeMs.toFixed(1)} ms</div>
            </div>
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5">
              <div className="text-[#5a5a5f] dark:text-white/85">Heap JS</div>
              <div className="font-mono text-neutral-700 dark:text-white">{formatMB(info.jsHeapMB)}</div>
            </div>
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5">
              <div className="text-[#5a5a5f] dark:text-white/85">API</div>
              <div className="font-mono text-neutral-700 dark:text-white">
                {info.backend === 'webgpu' ? 'WebGPU' : info.webgl2 ? 'WebGL2' : 'WebGL'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-inner flex items-center gap-2 bg-black/[0.04] dark:bg-black/[0.20] px-3 py-3 text-sm text-neutral-600 dark:text-white/85">
          <Gauge className="h-4 w-4 text-[#5a5a5f] dark:text-white/85" />
          Carga una escena para medir el objetivo movil.
        </div>
      )}
    </section>
  );
}
