export type BenchmarkStatus = 'ideal' | 'safe' | 'ok' | 'warn' | 'danger' | 'unknown';

export interface MetricScore {
  status: BenchmarkStatus;
  label: string;
}

export interface BenchmarkScore {
  fps: MetricScore;
  vram: MetricScore;
  splats: MetricScore;
  drawCalls: MetricScore;
  resolution: MetricScore;
  overall: MetricScore;
}

export interface BenchmarkInput {
  fps: number | null;
  estimatedVramMB: number | null;
  activeSplats: number;
  drawCalls: number | null;
  renderPixelRatio: number | null;
}

export interface VramEstimateInput {
  totalSplats: number;
  activeSplats: number;
  canvasPixels: number | null;
}

export const WEB_3D_BENCHMARK_2026 = {
  fps: {
    ideal: 60,
    acceptableMin: 30,
    redLine: 24,
  },
  vramMB: {
    safeMin: 150,
    safeMax: 350,
    risk: 600,
    crash: 1024,
  },
  gaussianSplats: {
    smoothMin: 1_000_000,
    smoothMax: 2_000_000,
    danger: 2_500_000,
  },
  drawCalls: {
    idealMax: 400,
    acceptableMax: 500,
  },
  renderPixelRatio: {
    mobileTargetMax: 1.5,
    risk: 2,
  },
};

const MB = 1024 * 1024;
const ESTIMATED_BYTES_PER_ACTIVE_SPLAT = 128;
const ESTIMATED_BYTES_PER_RENDER_PIXEL = 8;
const ESTIMATED_RENDER_OVERHEAD_MB = 32;

export function estimateGaussianSplatVramMB({
  totalSplats,
  activeSplats,
  canvasPixels,
}: VramEstimateInput): number | null {
  const splats = activeSplats > 0 ? activeSplats : totalSplats;
  if (splats <= 0 && (!canvasPixels || canvasPixels <= 0)) return null;

  const splatBytes = splats * ESTIMATED_BYTES_PER_ACTIVE_SPLAT;
  const renderBytes = (canvasPixels ?? 0) * ESTIMATED_BYTES_PER_RENDER_PIXEL;
  const totalBytes = splatBytes + renderBytes + ESTIMATED_RENDER_OVERHEAD_MB * MB;

  return Math.round((totalBytes / MB) * 10) / 10;
}

export function scoreBenchmark(input: BenchmarkInput): BenchmarkScore {
  const fps = scoreFps(input.fps);
  const vram = scoreVram(input.estimatedVramMB);
  const splats = scoreSplats(input.activeSplats);
  const drawCalls = scoreDrawCalls(input.drawCalls);
  const resolution = scoreResolution(input.renderPixelRatio);
  const overall = scoreOverall([fps, vram, splats, drawCalls, resolution]);

  return { fps, vram, splats, drawCalls, resolution, overall };
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}

function scoreFps(fps: number | null): MetricScore {
  if (fps === null) return { status: 'unknown', label: 'Sin muestra' };
  if (fps >= WEB_3D_BENCHMARK_2026.fps.ideal - 5) return { status: 'ideal', label: '60 FPS ideal' };
  if (fps >= WEB_3D_BENCHMARK_2026.fps.acceptableMin) return { status: 'safe', label: '30-45 FPS ok' };
  if (fps >= WEB_3D_BENCHMARK_2026.fps.redLine) return { status: 'warn', label: 'Cerca del limite' };
  return { status: 'danger', label: 'Bajo 24 FPS' };
}

function scoreVram(vramMB: number | null): MetricScore {
  if (vramMB === null) return { status: 'unknown', label: 'Estimando' };
  if (vramMB <= WEB_3D_BENCHMARK_2026.vramMB.safeMax) return { status: 'safe', label: 'Zona segura' };
  if (vramMB <= WEB_3D_BENCHMARK_2026.vramMB.risk) return { status: 'warn', label: 'Zona de riesgo' };
  if (vramMB <= WEB_3D_BENCHMARK_2026.vramMB.crash) return { status: 'danger', label: 'Riesgo alto' };
  return { status: 'danger', label: 'Crash probable' };
}

function scoreSplats(activeSplats: number): MetricScore {
  if (activeSplats <= 0) return { status: 'unknown', label: 'Sin escena' };
  if (activeSplats <= WEB_3D_BENCHMARK_2026.gaussianSplats.smoothMax) {
    return { status: 'safe', label: 'Rango movil' };
  }
  if (activeSplats <= WEB_3D_BENCHMARK_2026.gaussianSplats.danger) {
    return { status: 'warn', label: 'Culling recomendado' };
  }
  return { status: 'danger', label: 'Demasiados splats' };
}

function scoreDrawCalls(drawCalls: number | null): MetricScore {
  if (drawCalls === null) return { status: 'unknown', label: 'No disponible' };
  if (drawCalls <= WEB_3D_BENCHMARK_2026.drawCalls.idealMax) return { status: 'safe', label: '<400 ideal' };
  if (drawCalls <= WEB_3D_BENCHMARK_2026.drawCalls.acceptableMax) return { status: 'warn', label: '<500 aceptable' };
  return { status: 'danger', label: 'Reducir llamadas' };
}

function scoreResolution(renderPixelRatio: number | null): MetricScore {
  if (renderPixelRatio === null) return { status: 'unknown', label: 'Sin canvas' };
  if (renderPixelRatio <= WEB_3D_BENCHMARK_2026.renderPixelRatio.mobileTargetMax) {
    return { status: 'safe', label: 'DPR interno ok' };
  }
  if (renderPixelRatio <= WEB_3D_BENCHMARK_2026.renderPixelRatio.risk) {
    return { status: 'warn', label: 'DPR alto' };
  }
  return { status: 'danger', label: 'GPU saturable' };
}

function scoreOverall(scores: MetricScore[]): MetricScore {
  if (scores.some((score) => score.status === 'danger')) {
    return { status: 'danger', label: 'Fuera de objetivo' };
  }
  if (scores.some((score) => score.status === 'warn')) {
    return { status: 'warn', label: 'Ajustar escena' };
  }
  if (scores.some((score) => score.status === 'unknown')) {
    return { status: 'unknown', label: 'Cargando datos' };
  }
  if (scores.some((score) => score.status === 'ideal')) {
    return { status: 'ideal', label: 'Listo para movil' };
  }
  return { status: 'safe', label: 'Dentro del rango' };
}
