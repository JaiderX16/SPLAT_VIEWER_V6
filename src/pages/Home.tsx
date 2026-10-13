import { lazy, Suspense, useRef, useState, useCallback, useEffect } from 'react';
import WebGPUSplatViewer from '@/components/WebGPUSplatViewer';
import ProgressiveLoader, { type ProgressiveLoadState } from '@/components/ProgressiveLoader';
import SceneUploader, { type LoadOptions } from '@/components/SceneUploader';
import InfoPanel, { type SceneInfo } from '@/components/InfoPanel';
import PerformanceBenchmarkPanel, { type PerformanceBenchmarkInfo } from '@/components/PerformanceBenchmarkPanel';
import AdvancedControlsPanel from '@/components/AdvancedControlsPanel';
import { estimateGaussianSplatVramMB, scoreBenchmark } from '@/lib/performanceBenchmark';
import { isWebGPUAvailable } from '@/lib/webgpu-splat/SplatRenderer';
import {
  resolveFormat,
  type CameraView,
  type RenderBackend,
  type SplatViewerHandle,
  type ViewerStats,
} from '@/lib/viewerHandle';
import Sidebar from '@/components/Sidebar';
import SidebarMobileSheet, { type SheetState } from '@/components/SidebarMobileSheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  Trash2,
  Plus,
  Minus,
  Eye,
  EyeOff,
  Info,
  Settings2,
  Crosshair,
  ChevronRight,
  Activity,
  SlidersHorizontal,
  Camera,
} from 'lucide-react';

// The WebGL fallback (three.js + GaussianSplats3D, ~1 MB) is only downloaded
// when WebGPU is unavailable or a non-.splat format is opened.
const GaussianSplatViewer = lazy(() => import('@/components/GaussianSplatViewer'));

const DEMO_SCENES: Array<{ name: string; url: string; format: LoadOptions['format'] }> = [
  {
    name: 'APATA FUENTE',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/APATA-FUENTEt.splat',
    format: 'splat',
  },
  {
    name: 'Constitucion',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/Constitucion.splat',
    format: 'splat',
  },
  {
    name: 'Huamanmarca',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/Huamanmarca.splat',
    format: 'splat',
  },
  {
    name: 'Nike Shoe',
    url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat',
    format: 'splat',
  },
  {
    name: 'Train',
    url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/train.splat',
    format: 'splat',
  },
  {
    name: 'Plush Toy',
    url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/plush.splat',
    format: 'splat',
  },
  {
    name: 'parque-constitucion',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/constitucion.splat',
    format: 'splat',
  },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: number;
  };
}

function readJSHeapMB(): number | null {
  const bytes = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  return typeof bytes === 'number' ? Math.round((bytes / 1024 / 1024) * 10) / 10 : null;
}

const hasWebGL2 = (() => {
  let cached: boolean | null = null;
  return () => (cached ??= Boolean(document.createElement('canvas').getContext('webgl2')));
})();

const fmt3 = (v: [number, number, number] | null) => (v ? v.map((n) => n.toFixed(2)).join(', ') : 'N/A');

/** `?renderer=webgl` forces the fallback (handy for A/B benchmarking). */
function forcedBackend(): RenderBackend | null {
  const value = new URLSearchParams(window.location.search).get('renderer');
  return value === 'webgl' || value === 'webgpu' ? value : null;
}

type BackendState = RenderBackend | 'detecting';

export default function Home() {
  const viewerRef = useRef<SplatViewerHandle | null>(null);
  const viewerWaitersRef = useRef<Array<{ backend: RenderBackend; resolve: (h: SplatViewerHandle) => void }>>([]);
  const activeObjectUrlRef = useRef<string | null>(null);
  const webgpuAvailableRef = useRef(false);

  const [backend, setBackend] = useState<BackendState>('detecting');
  const [progressiveState, setProgressiveState] = useState<ProgressiveLoadState>({
    percent: 0,
    percentLabel: '0%',
    status: 'idle',
    message: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [hasScene, setHasScene] = useState(false);
  const [sceneInfo, setSceneInfo] = useState<SceneInfo | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [benchmarkInfo, setBenchmarkInfo] = useState<PerformanceBenchmarkInfo | null>(null);
  const [benchmarkVisible, setBenchmarkVisible] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [pointCloudMode, setPointCloudMode] = useState(false);
  const [splatScale, setSplatScale] = useState(1.0);
  const [activeScene, setActiveScene] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSheetState, setMobileSheetState] = useState<SheetState>('idle');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editorView, setEditorView] = useState(false);

  const isMobile = useIsMobile();

  // ─── Backend selection ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void isWebGPUAvailable().then((available) => {
      if (cancelled) return;
      webgpuAvailableRef.current = available;
      const forced = forcedBackend();
      setBackend(forced === 'webgl' || !available ? 'webgl' : 'webgpu');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Callback ref: resolves anyone waiting for a viewer of a given backend. */
  const attachViewer = useCallback((handle: SplatViewerHandle | null) => {
    viewerRef.current = handle;
    if (!handle) return;
    const waiters = viewerWaitersRef.current;
    viewerWaitersRef.current = waiters.filter((w) => {
      if (w.backend !== handle.backend) return true;
      // Let the viewer's mount effect run before it is used.
      requestAnimationFrame(() => w.resolve(handle));
      return false;
    });
  }, []);

  const getViewer = useCallback((wanted: RenderBackend): Promise<SplatViewerHandle> => {
    const current = viewerRef.current;
    if (current?.backend === wanted) return Promise.resolve(current);
    return new Promise((resolve) => {
      viewerWaitersRef.current.push({ backend: wanted, resolve });
      setBackend(wanted);
    });
  }, []);

  const handleWebGPUUnsupported = useCallback((error: Error) => {
    console.warn('WebGPU no disponible, usando WebGL:', error);
    webgpuAvailableRef.current = false;
    setBackend('webgl');
  }, []);

  const revokeActiveObjectUrl = useCallback(() => {
    if (!activeObjectUrlRef.current) return;
    URL.revokeObjectURL(activeObjectUrlRef.current);
    activeObjectUrlRef.current = null;
  }, []);

  // ─── Metrics ───────────────────────────────────────────────────────────────
  const updateSceneInfo = useCallback(() => {
    const stats: ViewerStats | null = viewerRef.current?.getStats() ?? null;
    if (!stats) return;

    const activeSplats = stats.renderCount > 0 ? stats.renderCount : stats.splatCount;
    const canvasPixels = stats.renderWidth && stats.renderHeight ? stats.renderWidth * stats.renderHeight : null;
    // WebGPU reports its exact buffer sizes; add color target + swapchain (≈8 B/px).
    const estimatedVramMB = stats.gpuBufferMB !== null
      ? Math.round((stats.gpuBufferMB + ((canvasPixels ?? 0) * 8) / 1048576) * 10) / 10
      : estimateGaussianSplatVramMB({ totalSplats: stats.splatCount, activeSplats, canvasPixels });

    setSceneInfo({
      splatCount: stats.splatCount,
      splatRenderCount: stats.renderCount,
      lodCulled: stats.lodCulled,
      fps: stats.fps,
      cameraPosition: fmt3(stats.cameraPosition),
      cameraLookAt: fmt3(stats.cameraTarget),
      cameraUp: fmt3(stats.cameraUp),
      sortTime: stats.sortTimeMs,
      splatScale: stats.splatScale,
      pointCloudMode: stats.pointCloudMode,
      backend: stats.backend,
    });

    setBenchmarkInfo({
      fps: stats.fps,
      estimatedVramMB,
      jsHeapMB: readJSHeapMB(),
      totalSplats: stats.splatCount,
      activeSplats,
      drawCalls: stats.drawCalls,
      sortTimeMs: stats.sortTimeMs,
      devicePixelRatio: window.devicePixelRatio || 1,
      renderPixelRatio: stats.renderPixelRatio,
      renderSize: stats.renderWidth ? `${stats.renderWidth}x${stats.renderHeight}` : 'N/A',
      webgl2: hasWebGL2(),
      webgpu: webgpuAvailableRef.current,
      backend: stats.backend,
      score: scoreBenchmark({
        fps: stats.fps,
        estimatedVramMB,
        activeSplats,
        drawCalls: stats.drawCalls,
        renderPixelRatio: stats.renderPixelRatio,
      }),
    });
  }, []);

  // Metric polling only runs when a scene is loaded and a panel is visible.
  const panelsVisible = infoVisible || benchmarkVisible;
  useEffect(() => {
    if (!hasScene || !panelsVisible) return;
    updateSceneInfo();
    const interval = setInterval(updateSceneInfo, 250);
    return () => clearInterval(interval);
  }, [hasScene, panelsVisible, updateSceneInfo]);

  useEffect(() => revokeActiveObjectUrl, [revokeActiveObjectUrl]);

  // ─── Loading callbacks ─────────────────────────────────────────────────────
  const handleProgress = useCallback((percent: number, percentLabel: string, status: number) => {
    let stateStatus: ProgressiveLoadState['status'] = 'downloading';
    let message = `Descargando: ${percentLabel}`;

    if (status === 1) {
      stateStatus = 'processing';
      message = 'Procesando splats...';
    } else if (status === 2) {
      stateStatus = 'done';
      message = '¡Listo!';
    }
    if (percent >= 100 && status === 0) {
      message = 'Descarga completa';
    }

    setProgressiveState({ percent, percentLabel, status: stateStatus, message });
  }, []);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
    setHasScene(true);
    setProgressiveState({ percent: 0, percentLabel: '0%', status: 'downloading', message: 'Iniciando descarga...' });
  }, []);

  const handleLoadComplete = useCallback(() => {
    setIsLoading(false);
    setHasScene(true);
    setProgressiveState({ percent: 100, percentLabel: '100%', status: 'done', message: 'Escena cargada' });
    setTimeout(() => {
      setProgressiveState((prev) => (prev.status === 'done' ? { ...prev, status: 'idle', message: '' } : prev));
    }, 2000);
  }, []);

  const handleError = useCallback((error: Error) => {
    console.error('Load error:', error);
    setIsLoading(false);
    setBenchmarkInfo(null);
    setProgressiveState({
      percent: 0,
      percentLabel: '0%',
      status: 'error',
      message: error.message || 'No se pudo cargar la escena',
    });
  }, []);

  const loadScene = useCallback(async (url: string, options?: Partial<LoadOptions>, nameHint = url) => {
    if (isLoading || backend === 'detecting') return; // no overlapping loads

    // The WebGPU renderer handles .splat; other formats use the WebGL fallback.
    const format = resolveFormat(options?.format, nameHint);
    const wanted: RenderBackend =
      webgpuAvailableRef.current && forcedBackend() !== 'webgl' && (format === 'splat' || format === 'auto')
        ? 'webgpu'
        : 'webgl';

    try {
      const previous = viewerRef.current;
      if (previous && previous.getSceneCount() > 0) {
        await previous.removeSplatScene(0);
      }
    } catch (e) {
      console.error('Error removing previous scene:', e);
    }
    setHasScene(false);
    setSceneInfo(null);
    setBenchmarkInfo(null);
    setActiveScene(url);

    try {
      const viewer = await getViewer(wanted);
      // Frame the camera first: the viewer's cinematic entrance starts from here.
      viewer.resetCamera();
      viewer.setEditorViewVisible(editorView);
      await viewer.addSplatScene(url, {
        splatAlphaRemovalThreshold: options?.splatAlphaRemovalThreshold ?? 1,
        progressiveLoad: options?.progressiveLoad ?? true,
        position: options?.position,
        rotation: options?.rotation,
        scale: options?.scale,
        format,
      });
      // GaussianSplats3D only accepts these once a scene exists.
      if (pointCloudMode) viewer.setPointCloudMode(true);
      if (splatScale !== 1) viewer.setSplatScale(splatScale);
    } catch (e) {
      handleError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [backend, editorView, getViewer, handleError, isLoading, pointCloudMode, splatScale]);

  const handleLoadFile = useCallback(async (file: File, options: LoadOptions) => {
    const url = URL.createObjectURL(file);
    revokeActiveObjectUrl();
    activeObjectUrlRef.current = url;
    setShowUploader(false);
    try {
      await loadScene(url, options, file.name);
    } finally {
      if (activeObjectUrlRef.current === url) {
        URL.revokeObjectURL(url);
        activeObjectUrlRef.current = null;
      }
    }
  }, [loadScene, revokeActiveObjectUrl]);

  const handleLoadURL = useCallback(async (url: string, options: LoadOptions) => {
    revokeActiveObjectUrl();
    setShowUploader(false);
    await loadScene(url, options);
  }, [loadScene, revokeActiveObjectUrl]);

  const handleRemoveScene = useCallback(async () => {
    if (!viewerRef.current) return;
    await viewerRef.current.removeSplatScene(0);
    setHasScene(false);
    setIsLoading(false);
    setSceneInfo(null);
    setBenchmarkInfo(null);
    setProgressiveState((prev) => ({ ...prev, status: 'idle', message: '' }));
    revokeActiveObjectUrl();
    setActiveScene('');
  }, [revokeActiveObjectUrl]);

  const handleTogglePointCloud = useCallback(() => {
    const next = !pointCloudMode;
    setPointCloudMode(next);
    viewerRef.current?.setPointCloudMode(next);
  }, [pointCloudMode]);

  const applySplatScale = useCallback((scale: number) => {
    const clamped = Math.min(3, Math.max(0.1, Math.round(scale * 100) / 100));
    setSplatScale(clamped);
    viewerRef.current?.setSplatScale(clamped);
  }, []);

  const handleResetCamera = useCallback(() => {
    viewerRef.current?.resetCamera();
  }, []);

  const handleDemoSelect = useCallback(async (sceneName: string) => {
    const scene = DEMO_SCENES.find((s) => s.name === sceneName);
    if (!scene) return;
    if (isMobile) setMobileSheetState('idle');
    await loadScene(scene.url, {
      progressiveLoad: true,
      splatAlphaRemovalThreshold: 1,
      format: scene.format,
    });
  }, [loadScene, isMobile]);

  // ─── Keyboard shortcuts for camera views (SuperSplat-style) ────────────────
  useEffect(() => {
    const viewByKey: Record<string, CameraView> = {
      '1': 'front',
      '2': 'back',
      '3': 'left',
      '4': 'right',
      '5': 'top',
      '6': 'bottom',
      '0': 'reset',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const view = viewByKey[e.key];
      if (view) viewerRef.current?.setCameraView(view);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const downloading = progressiveState.status === 'downloading' || progressiveState.status === 'processing';

  const viewerProps = {
    onProgress: handleProgress,
    onLoadStart: handleLoadStart,
    onLoadComplete: handleLoadComplete,
    onError: handleError,
  };

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-black">
      {/* ── Minimal top progress bar ── */}
      {downloading && (
        <div className="absolute top-0 left-0 right-0 z-[100] pointer-events-none">
          <div
            className="h-[2px] bg-gradient-to-r from-sky-400 via-indigo-400 to-fuchsia-400 shadow-[0_0_10px_rgba(56,189,248,0.6)] transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(2, progressiveState.percent)}%` }}
          />
        </div>
      )}

      {/* ── Sidebar (desktop) ── */}
      {!isMobile && sidebarOpen && (
        <Sidebar
          models={DEMO_SCENES}
          activeId={activeScene}
          onSelectModel={handleDemoSelect}
          onUpload={() => setShowUploader(true)}
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
          backend={backend}
        />
      )}

      {/* ── Sidebar Mobile Sheet ── */}
      {isMobile && (
        <SidebarMobileSheet
          sheetState={mobileSheetState}
          onSheetStateChange={setMobileSheetState}
          models={DEMO_SCENES}
          activeId={activeScene}
          onSelectModel={handleDemoSelect}
          onUpload={() => setShowUploader(true)}
          searchPlaceholder="Buscar escenas…"
        />
      )}

      {/* ── Uploader Dialog ── */}
      <Dialog open={showUploader} onOpenChange={setShowUploader}>
        <DialogContent className="glass glass-strong panel !rounded-[var(--ui-panel-radius)] text-white max-w-2xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="text-white font-semibold tracking-tight">Cargar escena</DialogTitle>
          </DialogHeader>
          <SceneUploader onLoadFile={handleLoadFile} onLoadURL={handleLoadURL} isLoading={isLoading} />
        </DialogContent>
      </Dialog>

      {/* ── Open sidebar button (desktop only) ── */}
      {!isMobile && !sidebarOpen && (
        <div className="absolute top-6 left-6 z-[300] glass dock">
          <button onClick={() => setSidebarOpen(true)} className="pill-btn" title="Mostrar panel" aria-label="Mostrar panel">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ── Main Viewer ── */}
      <main className="absolute inset-0">
        {backend === 'webgpu' && (
          <WebGPUSplatViewer ref={attachViewer} {...viewerProps} onUnsupported={handleWebGPUUnsupported} />
        )}
        {backend === 'webgl' && (
          <Suspense fallback={null}>
            <GaussianSplatViewer ref={attachViewer} {...viewerProps} />
          </Suspense>
        )}

        <ProgressiveLoader state={progressiveState} />
        <InfoPanel info={sceneInfo} visible={infoVisible} onToggle={() => setInfoVisible((v) => !v)} />
        <PerformanceBenchmarkPanel info={benchmarkInfo} visible={benchmarkVisible} />

        {/* Splat scale: pill group with concentric inner pills */}
        {hasScene && !advancedOpen && (
          <div
            // Sits beside the 320px sidebar (left-4 + 320 + 16px gap) when it is open.
            className={`absolute z-40 glass dock items-center ${
              isMobile ? 'left-4 bottom-24' : sidebarOpen ? 'left-[352px] bottom-4' : 'left-4 bottom-4'
            }`}
            role="group"
            aria-label="Escala de splats"
          >
            <span className="pill-btn pointer-events-none !text-white/40" aria-hidden>
              <Settings2 className="w-4 h-4" />
            </span>
            <button className="pill-btn" onClick={() => applySplatScale(splatScale - 0.05)} aria-label="Reducir escala">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <Slider
              value={[splatScale]}
              onValueChange={(v) => applySplatScale(v[0])}
              min={0.1}
              max={3.0}
              step={0.05}
              className="w-28 sm:w-40 mx-1"
              aria-label="Escala de splats"
            />
            <button className="pill-btn" onClick={() => applySplatScale(splatScale + 0.05)} aria-label="Aumentar escala">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <span className="text-white/60 text-xs font-mono w-10 pr-3 text-right tabular-nums">{splatScale.toFixed(2)}</span>
          </div>
        )}
      </main>

      {/* ── Right-side dock ── */}
      <nav
        aria-label="Herramientas del visor"
        className="absolute top-4 right-4 md:top-6 md:right-6 z-[25000] glass dock flex-col items-center"
      >
        <button className="pill-btn" onClick={handleResetCamera} title="Enfocar escena (0)" aria-label="Enfocar escena">
          <Crosshair className="w-4 h-4" />
        </button>
        <button
          className="pill-btn"
          onClick={handleTogglePointCloud}
          title={pointCloudMode ? 'Modo splats' : 'Modo puntos'}
          aria-label="Alternar modo puntos"
          aria-pressed={pointCloudMode}
        >
          {pointCloudMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
        <button
          className="pill-btn"
          onClick={() => setAdvancedOpen((v) => !v)}
          title="Controles avanzados"
          aria-label="Controles avanzados"
          aria-pressed={advancedOpen}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        {backend !== 'detecting' && (
          <button
            className="pill-btn"
            onClick={() => {
              const next = !editorView;
              setEditorView(next);
              viewerRef.current?.setEditorViewVisible(next);
            }}
            title="Vista editor: cámara, frustum y minimapa (clic para navegar)"
            aria-label="Modo editor"
            aria-pressed={editorView}
          >
            <Camera className="w-4 h-4" />
          </button>
        )}

        <div className="dock-divider my-1" />

        <button
          className="pill-btn"
          onClick={() => {
            const next = !benchmarkVisible;
            setBenchmarkVisible(next);
            if (next) setInfoVisible(false);
          }}
          title="Benchmark 2026"
          aria-label="Benchmark"
          aria-pressed={benchmarkVisible}
        >
          <Activity className="w-4 h-4" />
        </button>
        <button
          className="pill-btn"
          onClick={() => {
            const next = !infoVisible;
            setInfoVisible(next);
            if (next) setBenchmarkVisible(false);
          }}
          title="Información"
          aria-label="Información de la escena"
          aria-pressed={infoVisible}
        >
          <Info className="w-4 h-4" />
        </button>

        {hasScene && (
          <>
            <div className="dock-divider my-1" />
            <button className="pill-btn pill-btn--danger" onClick={handleRemoveScene} title="Eliminar escena" aria-label="Eliminar escena">
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </nav>

      {/* ── Editor view frame: matches the GPU picture-in-picture rect (30%, min 120px, 12px margin) ── */}
      {editorView && (
        <div className="absolute bottom-3 right-3 w-[30%] h-[30%] min-w-[120px] min-h-[120px] pointer-events-none border border-cyan-400/40 rounded-[4px] z-[200]">
          <span className="absolute -top-8 right-0 glass rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200/90 whitespace-nowrap">
            {backend === 'webgpu' ? 'Vista editor · clic para navegar' : 'Vista editor'}
          </span>
        </div>
      )}

      <AdvancedControlsPanel viewerRef={viewerRef} visible={advancedOpen} onClose={() => setAdvancedOpen(false)} />
    </div>
  );
}
