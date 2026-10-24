import { lazy, Suspense, useRef, useState, useCallback, useEffect } from 'react';
import WebGPUSplatViewer from '@/components/WebGPUSplatViewer';
import ProgressiveLoader, { type ProgressiveLoadState } from '@/components/ProgressiveLoader';
import SceneUploader, { type LoadOptions } from '@/components/SceneUploader';
import InfoPanel, { type SceneInfo } from '@/components/InfoPanel';
import PerformanceBenchmarkPanel, { type PerformanceBenchmarkInfo } from '@/components/PerformanceBenchmarkPanel';
import AdvancedControlsPanel from '@/components/AdvancedControlsPanel';
import NavigationPanel from '@/components/NavigationPanel';
import { estimateGaussianSplatVramMB, scoreBenchmark } from '@/lib/performanceBenchmark';
import { isWebGPUAvailable } from '@/lib/webgpu-splat/SplatRenderer';
import { useTheme } from '@/hooks/useTheme';
import {
  resolveFormat,
  type CameraView,
  type NavigationSettings,
  NAVIGATION_CYCLE,
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
import {
  Trash2,
  Eye,
  EyeOff,
  Info,
  Crosshair,
  ChevronRight,
  Activity,
  SlidersHorizontal,
  Camera,
  Compass,
  Sun,
  Moon,
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
    name: 'APATA FUENTE HD',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/APATA-FUENTE.splat',
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
    name: 'Lago Azul',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/LAGO-AZUL.splat',
    format: 'splat',
  },
  {
    name: 'Taza',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/TAZA.splat',
    format: 'splat',
  },
  {
    name: 'Torre',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/Torre.splat',
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

interface SplatViewerProps {
  /** Show the sidebar, dock and panels (default). Off: just the scene; keyboard shortcuts still work. */
  showUI?: boolean;
  /** Scene to load on mount (e.g. an embedded viewer with `showUI={false}`). */
  src?: string;
}

export default function Home({ showUI = true, src }: SplatViewerProps) {
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
  const [activeScene, setActiveScene] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSheetState, setMobileSheetState] = useState<SheetState>('idle');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigation, setNavigation] = useState<NavigationSettings>({ mode: 'orbit', speed: 1, gyro: false });
  const navigationRef = useRef(navigation);
  const applyNavigation = useCallback((patch: Partial<NavigationSettings>) => {
    const next = { ...navigationRef.current, ...patch };
    navigationRef.current = next;
    setNavigation(next);
    viewerRef.current?.setNavigation?.(next);
  }, []);
  const [editorView, setEditorView] = useState(false);

  const isMobile = useIsMobile();
  const { theme, toggleTheme } = useTheme();
  // The 3D scene background follows the UI theme (palette field colors) until
  // the user flips it from the advanced panel; then it stays as chosen.
  const [sceneBgOverride, setSceneBgOverride] = useState<'light' | 'dark' | null>(null);
  const sceneLight = (sceneBgOverride ?? theme) === 'light';
  const sceneBackground = sceneLight ? '#c8c8cd' : '#000000';

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
      // Frame the camera first: the viewer's cinematic entrance (an orbit) starts from here.
      applyNavigation({ mode: 'orbit' });
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
    } catch (e) {
      handleError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [applyNavigation, backend, editorView, getViewer, handleError, isLoading, pointCloudMode]);

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

  const handleResetCamera = useCallback(() => {
    applyNavigation({ mode: 'orbit' });
    viewerRef.current?.resetCamera();
  }, [applyNavigation]);

  const autoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!src || backend === 'detecting' || autoLoadedRef.current === src) return;
    autoLoadedRef.current = src;
    void loadScene(src, { progressiveLoad: true, splatAlphaRemovalThreshold: 1 });
  }, [src, backend, loadScene]);

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
      if (e.code === 'KeyV' && viewerRef.current?.setNavigation) {
        const i = NAVIGATION_CYCLE.indexOf(navigationRef.current.mode);
        applyNavigation({ mode: NAVIGATION_CYCLE[(i + 1) % NAVIGATION_CYCLE.length] });
        return;
      }
      const view = viewByKey[e.key];
      if (view) viewerRef.current?.setCameraView(view);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyNavigation]);

  const viewerProps = {
    onProgress: handleProgress,
    onLoadStart: handleLoadStart,
    onLoadComplete: handleLoadComplete,
    onError: handleError,
    background: sceneBackground,
    theme,
  };

  return (
    <div className="msv">

      {showUI && (
        <>
          {/* ── Sidebar (desktop) ── */}
          {!isMobile && sidebarOpen && (
            <Sidebar
              models={DEMO_SCENES}
              activeId={activeScene}
              onSelectModel={handleDemoSelect}
              onUpload={() => setShowUploader(true)}
              isOpen={sidebarOpen}
              setIsOpen={setSidebarOpen}
            />
          )}

          {/* ── Sidebar Mobile Sheet (hidden while the settings panel uses the bottom of the screen) ── */}
          {isMobile && !advancedOpen && (
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
            <DialogContent className="glass glass-strong panel !rounded-[var(--ui-panel-radius)] text-neutral-900 dark:text-white max-w-2xl max-h-[90vh] overflow-y-auto p-6">
              <DialogHeader>
                <DialogTitle className="text-neutral-900 dark:text-white font-semibold tracking-tight">Cargar escena</DialogTitle>
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
        </>
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
        {showUI && (
          <>
            <InfoPanel info={sceneInfo} visible={infoVisible} onToggle={() => setInfoVisible((v) => !v)} />
            {navigationOpen && backend === 'webgpu' && (
              <NavigationPanel settings={navigation} onChange={applyNavigation} onClose={() => setNavigationOpen(false)} />
            )}
            <PerformanceBenchmarkPanel info={benchmarkInfo} visible={benchmarkVisible} />
          </>
        )}
      </main>

      {showUI && (
        <>
          {/* ── Right-side dock ── */}
          <nav
            aria-label="Herramientas del visor"
            className="absolute top-4 right-4 md:top-6 md:right-6 z-[25000] glass dock flex-col items-center"
          >
            <button
              className="pill-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" strokeWidth={1.5} /> : <Moon className="w-4 h-4" strokeWidth={1.5} />}
            </button>
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

            {backend === 'webgpu' && (
              <button
                className="pill-btn"
                onClick={() => {
                  const next = !navigationOpen;
                  setNavigationOpen(next);
                  if (next) {
                    setBenchmarkVisible(false);
                    setInfoVisible(false);
                  }
                }}
                title="Navegación (V cambia de modo)"
                aria-label="Navegación"
                aria-pressed={navigationOpen}
              >
                <Compass className="w-4 h-4" />
              </button>
            )}
            <button
              className="pill-btn"
              onClick={() => {
                const next = !benchmarkVisible;
                setBenchmarkVisible(next);
                if (next) {
                  setInfoVisible(false);
                  setNavigationOpen(false);
                }
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
                if (next) {
                  setBenchmarkVisible(false);
                  setNavigationOpen(false);
                }
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
            <div className="absolute bottom-3 right-3 w-[30%] h-[30%] min-w-[120px] min-h-[120px] pointer-events-none border border-cyan-600 dark:border-cyan-300/60 rounded-[4px] z-[200]">
              <span className="absolute -top-8 right-0 glass rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-900 dark:text-cyan-200 whitespace-nowrap">
                {backend === 'webgpu' ? 'Vista editor · clic para navegar' : 'Vista editor'}
              </span>
            </div>
          )}

          <AdvancedControlsPanel
            viewerRef={viewerRef}
            visible={advancedOpen}
            onClose={() => setAdvancedOpen(false)}
            sceneLight={sceneLight}
            onToggleSceneBackground={() => setSceneBgOverride(sceneLight ? 'dark' : 'light')}
          />
        </>
      )}
    </div>
  );
}
