import { useState, type ReactNode } from 'react';
import { Activity, Cpu, Gauge, Layers3, Maximize2, Minimize2, MonitorSmartphone, Workflow, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProgressRing from '@/components/ProgressRing';
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
  /** Phones: open the full benchmark in the bottom sheet instead of over the scene. */
  onExpand?: () => void;
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

const statusBadgeClass = 'shrink-0 rounded-full border border-black/[0.06] dark:border-white/[0.14] bg-black/[0.05] dark:bg-black/[0.20] px-3 py-1 text-[11px] font-semibold';

/** The active-splat count in a ring that fills with the share of the scene being drawn. */
function SplatRing({ active, total }: { active: number | null; total: number }) {
  const share = active !== null && total > 0 ? Math.min(1, active / total) : 0;
  const label = active === null
    ? 'Sin escena'
    : `${formatCompactNumber(active)} splats activos: ${Math.round(share * 100)} % de la escena en pantalla`;
  return (
    <ProgressRing value={share} label={label}>
      {active === null ? '—' : formatCompactNumber(active)}
    </ProgressRing>
  );
}

export default function PerformanceBenchmarkPanel({ info, visible, onExpand }: PerformanceBenchmarkPanelProps) {
  // The compact pill by default; the full benchmark on demand.
  const [expanded, setExpanded] = useState(false);
  if (!visible) return null;

  if (!expanded) {
    return (
      // pad 6 + 44px circle r22 = 28 (.dock). Phones: centered between the loading circle and the menu; desktop: beside the dock.
      <section
        aria-label="Rendimiento"
        // w-max: at left 50% the pill would only get the right half of the screen and wrap its text
        className="absolute left-1/2 top-4 z-[240] w-max -translate-x-1/2 glass dock items-center gap-3 isolate text-neutral-900 dark:text-white md:left-auto md:top-6 md:right-[6.5rem] md:translate-x-0"
      >
        <SplatRing active={info ? info.activeSplats : null} total={info?.totalSplats ?? 0} />
        {info ? (
          <p className="flex items-baseline gap-1.5 px-1">
            {/* 3 digits wide, so the pill does not jitter as the rate changes */}
            <span className="w-[3ch] text-right font-mono text-base font-semibold tabular-nums">
              {info.fps === null ? '—' : Math.round(info.fps)}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#46464b] dark:text-white/85">FPS</span>
          </p>
        ) : (
          <p className="px-1 text-sm font-medium text-neutral-800 dark:text-white/85">Sin escena</p>
        )}
        <button
          type="button"
          onClick={() => (onExpand ? onExpand() : setExpanded(true))}
          title="Ver benchmark completo"
          aria-label="Ver benchmark completo"
          className="pill-btn shrink-0 bg-black/[0.04] hover:bg-black/[0.08] dark:bg-black/[0.20] dark:hover:bg-black/[0.32]"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
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
          <Button
            onClick={() => setExpanded(false)}
            variant="ghost"
            size="icon"
            title="Vista compacta"
            aria-label="Vista compacta"
            className="h-8 w-8 shrink-0 rounded-full text-[#46464b] dark:text-white/85 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-black/[0.14]"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <BenchmarkDetails info={info} />
    </section>
  );
}

/** The full benchmark: metric rows and timing chips. The floating panel's body, or the mobile sheet's (embedded). */
export function BenchmarkDetails({ info, embedded = false }: { info: PerformanceBenchmarkInfo | null; embedded?: boolean }) {
  return (
    <>
      {/* The floating panel shows the target and the verdict in its header; the sheet has only a title there */}
      {embedded && (
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <p className="min-w-0 truncate text-[11px] text-[#46464b] dark:text-white/85">iPhone 13/14, A54/A55, Pixel 7a</p>
          <span className={`${statusBadgeClass} ${statusTextClass[info?.score.overall.status ?? 'unknown']}`}>
            {info?.score.overall.label ?? 'Sin escena'}
          </span>
        </div>
      )}
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
    </>
  );
}
