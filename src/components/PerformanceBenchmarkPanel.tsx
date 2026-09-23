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
  ideal: 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.55)]',
  safe: 'bg-emerald-400',
  ok: 'bg-sky-400',
  warn: 'bg-amber-400',
  danger: 'bg-red-400',
  unknown: 'bg-white/30',
};

const statusTextClass: Record<BenchmarkStatus, string> = {
  ideal: 'text-emerald-200',
  safe: 'text-emerald-300',
  ok: 'text-sky-300',
  warn: 'text-amber-300',
  danger: 'text-red-300',
  unknown: 'text-white/45',
};

function MetricRow({ icon, label, value, detail, status }: MetricRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-white/55">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
            {label}
          </div>
          <div className={`truncate text-xs ${statusTextClass[status]}`}>{detail}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 font-mono text-sm text-white">
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
      className="absolute left-3 right-[4.75rem] top-4 z-[240] rounded-lg border border-white/10 bg-black/75 p-3 text-white shadow-2xl backdrop-blur-md md:left-auto md:right-24 md:w-[360px]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-300" />
            <h2 className="truncate text-sm font-semibold">Benchmark 2026</h2>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/45">
            iPhone 13/14, A54/A55, Pixel 7a
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-semibold ${statusTextClass[info?.score.overall.status ?? 'unknown']}`}
        >
          {info?.score.overall.label ?? 'Sin escena'}
        </span>
      </div>

      {info ? (
        <div className="space-y-2.5">
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

          <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-2 text-[11px]">
            <div className="rounded-md bg-white/[0.04] px-2 py-1.5">
              <div className="text-white/35">Sort</div>
              <div className="font-mono text-white/75">{info.sortTimeMs.toFixed(1)} ms</div>
            </div>
            <div className="rounded-md bg-white/[0.04] px-2 py-1.5">
              <div className="text-white/35">Heap JS</div>
              <div className="font-mono text-white/75">{formatMB(info.jsHeapMB)}</div>
            </div>
            <div className="rounded-md bg-white/[0.04] px-2 py-1.5">
              <div className="text-white/35">API</div>
              <div className="font-mono text-white/75">
                {info.webgl2 ? 'GL2' : 'GL1'} / {info.webgpu ? 'GPU' : '--'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/55">
          <Gauge className="h-4 w-4 text-white/35" />
          Carga una escena para medir el objetivo movil.
        </div>
      )}
    </section>
  );
}
