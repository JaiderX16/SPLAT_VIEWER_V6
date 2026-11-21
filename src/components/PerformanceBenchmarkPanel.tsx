import { useState, type ReactNode } from 'react';
import { Activity, Cpu, Gauge, Layers3, Maximize2, Minimize2, MonitorSmartphone, Workflow, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BenchmarkScore, BenchmarkStatus } from '@/lib/performanceBenchmark';
import { formatCompactNumber } from '@/lib/performanceBenchmark';

export interface PerformanceBenchmarkInfo {
  fps: number | null;
  estimatedVramMB: number | null;
  jsHeapMB: number | null;
  totalSplats: number;
  activeSplats: number;
  /** Splats hidden because the camera does not see them (null when the option is off or unsupported). */
  offscreenCulled: number | null;
  /** Splats hidden behind walls and objects the camera sees first (null when off or unsupported). */
  occlusionCulled: number | null;
  /** Splats under the floor, cut (null when off or unsupported). */
  undergroundCulled: number | null;
  /** Splats thinned by distance LOD and the splat budget. */
  lodCulled: number;
  /** In-view giant and needle splats hidden as noise (null when off or unsupported). */
  noiseCulled: number | null;
  drawCalls: number | null;
  sortTimeMs: number;
  /** GPU time of the splat pass, ms (null without timestamp queries). */
  gpuMs: number | null;
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
  /** Line under the label, in the status colour (omitted in the compact card). */
  detail?: string;
  /** Dot beside the value; none for plain readings. */
  status?: BenchmarkStatus;
}

const statusDotClass: Record<BenchmarkStatus, string> = {
  ideal: 'bg-emerald-700 shadow-[0_0_0_3px_rgba(16,185,129,0.18)] dark:bg-emerald-300 dark:shadow-[0_0_10px_rgba(110,231,183,0.55)]',
  safe: 'bg-emerald-700 dark:bg-emerald-300',
  ok: 'bg-sky-700 dark:bg-sky-300',
  warn: 'bg-amber-800 dark:bg-amber-300',
  danger: 'bg-red-700 dark:bg-red-200',
  unknown: 'bg-neutral-400 dark:bg-white/40',
};

const statusTextClass: Record<BenchmarkStatus, string> = {
  ideal: 'text-emerald-900 dark:text-emerald-100',
  safe: 'text-emerald-900 dark:text-emerald-100',
  ok: 'text-sky-900 dark:text-sky-100',
  warn: 'text-amber-900 dark:text-amber-200',
  danger: 'text-red-900 dark:text-red-100',
  unknown: 'text-[#46464b] dark:text-white/85',
};

function MetricRow({ icon, label, value, detail, status }: MetricRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-black/[0.20] text-neutral-800 dark:text-white/85">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[#46464b] dark:text-white/85">
            {label}
          </div>
          {detail && <div className={`truncate text-xs ${statusTextClass[status ?? 'unknown']}`}>{detail}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 font-mono text-sm tabular-nums text-neutral-900 dark:text-white">
        {status && <span className={`h-2 w-2 rounded-full ${statusDotClass[status]}`} />}
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

function apiName(info: PerformanceBenchmarkInfo): string {
  return info.backend === 'webgpu' ? 'WebGPU' : info.webgl2 ? 'WebGL2' : 'WebGL';
}

/** One word for how smooth the frame rate is. */
const smoothness: Record<BenchmarkStatus, string> = {
  ideal: 'Fluido',
  safe: 'Estable',
  ok: 'Estable',
  warn: 'Justo',
  danger: 'Lento',
  unknown: 'Midiendo',
};

const statusBadgeClass = 'shrink-0 rounded-full border border-black/[0.06] dark:border-white/[0.14] bg-black/[0.05] dark:bg-black/[0.20] px-3 py-1 text-[11px] font-semibold';

/** 32px header circle that switches between the compact card and the full benchmark. */
function SizeButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const label = expanded ? 'Vista compacta' : 'Ver benchmark completo';
  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      className="h-8 w-8 shrink-0 rounded-full text-[#46464b] dark:text-white/85 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-black/[0.14]"
    >
      {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </Button>
  );
}

export default function PerformanceBenchmarkPanel({ info, visible }: PerformanceBenchmarkPanelProps) {
  // The compact "Rendimiento" card by default; the full benchmark on demand.
  const [expanded, setExpanded] = useState(false);
  if (!visible) return null;

  if (!expanded) {
    const fps = info?.score.fps.status ?? 'unknown';
    return (
      // pad 12 + inset group r22 = 34
      <section
        aria-label="Rendimiento"
        className="absolute right-[5.5rem] top-4 z-[240] w-[280px] glass rounded-[34px] p-3 isolate text-neutral-900 dark:text-white md:top-6 md:right-[6.5rem]"
      >
        <div className="mb-3 flex items-center justify-between gap-2 pl-2">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-sky-900 dark:text-sky-100" />
            <h2 className="truncate text-sm font-semibold">Rendimiento</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className={`${statusBadgeClass} ${statusTextClass[info ? fps : 'unknown']}`}>{info ? smoothness[fps] : 'Sin escena'}</span>
            <SizeButton expanded={false} onClick={() => setExpanded(true)} />
          </div>
        </div>

        {info ? (
          // pad 8 + 28px circle r14 = 22
          <div className="rounded-[22px] bg-black/[0.04] dark:bg-black/[0.20] p-2 space-y-2.5">
            <MetricRow icon={<Gauge className="h-3.5 w-3.5" />} label="FPS" value={formatFps(info.fps)} status={fps} />
            <MetricRow icon={<Layers3 className="h-3.5 w-3.5" />} label="Splats activos" value={formatCompactNumber(info.activeSplats)} status={info.score.splats.status} />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-[22px] bg-black/[0.04] dark:bg-black/[0.20] px-3 py-3 text-sm text-neutral-800 dark:text-white/85">
            <Gauge className="h-4 w-4 shrink-0 text-[#46464b] dark:text-white/85" />
            Carga una escena para medir.
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Benchmark de rendimiento Web 3D 2026"
      className="absolute left-3 right-[5.5rem] top-4 z-[240] glass panel isolate text-neutral-900 dark:text-white md:left-auto md:top-6 md:right-[6.5rem] md:w-[360px]"
    >
      <div className="mb-3 flex items-start justify-between gap-3 px-2 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-900 dark:text-sky-100" />
            <h2 className="truncate text-sm font-semibold">Benchmark 2026</h2>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[#46464b] dark:text-white/85">
            iPhone 13/14, A54/A55, Pixel 7a
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`${statusBadgeClass} ${statusTextClass[info?.score.overall.status ?? 'unknown']}`}>
            {info?.score.overall.label ?? 'Sin escena'}
          </span>
          <SizeButton expanded onClick={() => setExpanded(false)} />
        </div>
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
            detail={`${formatCompactNumber(info.totalSplats)} totales${info.offscreenCulled !== null ? ` · ${formatCompactNumber(info.offscreenCulled)} fuera` : ''}${info.occlusionCulled ? ` · ${formatCompactNumber(info.occlusionCulled)} tapados` : ''}${info.lodCulled > 0 ? ` · ${formatCompactNumber(info.lodCulled)} fusionados` : ''}${info.noiseCulled ? ` · ${formatCompactNumber(info.noiseCulled)} ruido` : ''}${info.undergroundCulled ? ` · ${formatCompactNumber(info.undergroundCulled)} bajo el suelo` : ''}`}
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

          <div className="grid grid-cols-4 gap-2 border-t border-black/[0.06] dark:border-white/[0.14] pt-2 text-[11px]">
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5">
              <div className="text-[#46464b] dark:text-white/85">Sort</div>
              <div className="font-mono text-neutral-800 dark:text-white">{info.sortTimeMs.toFixed(1)} ms</div>
            </div>
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5" title="Tiempo de GPU del último fotograma dibujado">
              <div className="text-[#46464b] dark:text-white/85">GPU</div>
              <div className="font-mono text-neutral-800 dark:text-white">{info.gpuMs === null ? 'N/A' : `${info.gpuMs.toFixed(1)} ms`}</div>
            </div>
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5">
              <div className="text-[#46464b] dark:text-white/85">Heap JS</div>
              <div className="font-mono text-neutral-800 dark:text-white">{formatMB(info.jsHeapMB)}</div>
            </div>
            <div className="panel-chip bg-black/[0.04] dark:bg-black/[0.20] px-2 py-1.5">
              <div className="text-[#46464b] dark:text-white/85">API</div>
              <div className="font-mono text-neutral-800 dark:text-white">{apiName(info)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-inner flex items-center gap-2 bg-black/[0.04] dark:bg-black/[0.20] px-3 py-3 text-sm text-neutral-800 dark:text-white/85">
          <Gauge className="h-4 w-4 text-[#46464b] dark:text-white/85" />
          Carga una escena para medir el objetivo movil.
        </div>
      )}
    </section>
  );
}
