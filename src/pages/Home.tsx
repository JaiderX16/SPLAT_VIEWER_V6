import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState, useCallback, useEffect } from 'react';
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
  type NavigationMode,
  type RenderBackend,
  type SplatViewerHandle,
  type ViewerStats,
  type CameraFraming,
  type LodQuality,
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
  Box,
  Upload,
  Maximize,
  Minimize,
} from 'lucide-react';

// The WebGL fallback (three.js + GaussianSplats3D, ~1 MB) is only downloaded
// when WebGPU is unavailable or a non-.splat format is opened.
const GaussianSplatViewer = lazy(() => import('@/components/GaussianSplatViewer'));

// Escena local (carpeta model/), disponible en la biblioteca.
export const DEFAULT_SCENE_URL = 'model/scene.splat';

const DEMO_SCENES: Array<{ name: string; url: string; format: LoadOptions['format'] }> = [
  {
    name: 'Scene',
    url: DEFAULT_SCENE_URL,
    format: 'splat',
  },
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
  {
    name: 'Oficina',
    url: 'https://huggingface.co/datasets/JaiderX16/MemorIA/resolve/main/oficina.splat',
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
  /** Navigation once `src` has loaded: 'orbit' circles an exterior, 'interior' walks it at head height, 'look' stands inside. */
  initialNavigation?: NavigationMode;
  /** Encuadre de `src`: punto que rodea la cámara, distancia y ángulos (solo WebGPU). */
  framing?: CameraFraming;
  /**
   * Calidad por distancia. Por defecto 'high' sin UI (visor incrustado pequeño: el aclarado de
   * splats lejanos lo deja borroso y su coste es bajo) y 'balanced' con UI.
   */
  quality?: LodQuality;
}

/** Lo que el host puede pedirle al visor por `ref`. */
export interface SplatViewerRef {
  /** Encuadre actual de la cámara (órbita u ojo en primera persona), para guardarlo; null sin escena WebGPU. */
  getFraming: () => CameraFraming | null;
  /** Vuelve al encuadre con que se cargó la escena. */
  resetCamera: () => void;
  /** Velocidad del giro automático en vueltas por minuto (0 lo para); para previsualizarla. */
  setSpinSpeed: (rpm: number) => void;
}

const Home = forwardRef<SplatViewerRef, SplatViewerProps>(function Home({ showUI = true, src, initialNavigation = 'orbit', framing, quality }, ref) {
  const appRef = useRef<HTMLDivElement | null>(null);
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
  useImperativeHandle(ref, () => ({
    getFraming: () => viewerRef.current?.getCameraFraming?.() ?? null,
    resetCamera: () => viewerRef.current?.resetCamera(),
    setSpinSpeed: (rpm: number) => viewerRef.current?.setSpinSpeed?.(rpm),
  }), []);
  const [editorView, setEditorView] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isMobile = useIsMobile();
  const { theme, toggleTheme } = useTheme();
  // The 3D scene background follows the UI theme (palette field colors) until
  // the user flips it from the advanced panel; then it stays as chosen.
  const [sceneBgOverride, setSceneBgOverride] = useState<'light' | 'dark' | null>(null);
  const sceneLight = (sceneBgOverride ?? theme) === 'light';
  const sceneBackground = sceneLight ? '#c8c8cd' : '#000000';

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === appRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const app = appRef.current;
    if (!app || !document.fullscreenEnabled) return;

    try {
      if (document.fullscreenElement === app) {
        await document.exitFullscreen();
      } else {
        await app.requestFullscreen();
      }
    } catch (error) {
      console.error('No se pudo cambiar el modo de pantalla completa.', error);
    }
  }, []);

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
    setActiveScene('');
    setBenchmarkInfo(null);
    setProgressiveState({
      percent: 0,
      percentLabel: '0%',
      status: 'error',
      message: error.message || 'No se pudo cargar la escena',
    });
  }, []);

  const loadScene = useCallback(async (url: string, options?: Partial<LoadOptions> & { framing?: CameraFraming }, nameHint = url) => {
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
      if (lodQualityRef.current) viewer.setLodQuality(lodQualityRef.current);
      await viewer.addSplatScene(url, {
        framing: options?.framing,
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

  // Encuadre y calidad del visor incrustado: se leen al cargar `src`.
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const lodQualityRef = useRef<LodQuality | undefined>(quality ?? (showUI ? undefined : 'high'));
  lodQualityRef.current = quality ?? (showUI ? undefined : 'high');

  const autoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!src || backend === 'detecting' || autoLoadedRef.current === src) return;
    autoLoadedRef.current = src;
    void loadScene(src, { progressiveLoad: true, splatAlphaRemovalThreshold: 1, framing: framingRef.current ?? undefined }).then(() => {
      // First-person modes probe the ground, so they wait for the whole scene.
      if (initialNavigation === 'orbit' || autoLoadedRef.current !== src) return;
      applyNavigation({ mode: initialNavigation });
      // Interior con encuadre guardado: exactamente donde se dejó, sin buscar el suelo.
      const f = framingRef.current;
      if (f?.eye) viewerRef.current?.standAt?.(f.eye, f.target);
    });
  }, [src, backend, loadScene, initialNavigation, applyNavigation]);

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
    <div ref={appRef} className="msv">

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
            <DialogContent className="glass glass-strong panel isolate !rounded-[var(--ui-panel-radius)] text-neutral-900 dark:text-white max-w-2xl max-h-[90vh] overflow-y-auto p-6">
              <DialogHeader>
                <DialogTitle className="text-neutral-900 dark:text-white font-semibold tracking-tight">Cargar escena</DialogTitle>
              </DialogHeader>
              <SceneUploader onLoadFile={handleLoadFile} onLoadURL={handleLoadURL} isLoading={isLoading} />
            </DialogContent>
          </Dialog>

          {/* ── Open sidebar button (desktop only) ── */}
          {!isMobile && !sidebarOpen && (
            <div className="absolute top-6 left-6 z-[300] glass dock isolate">
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

        <ProgressiveLoader state={progressiveState} compact={!showUI} />
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
          {!hasScene && !activeScene && (
            <section className="absolute inset-0 z-[150] flex items-center justify-center p-4 md:p-8 pointer-events-none">
              <div className="glass glass-strong w-full max-w-3xl max-h-[78vh] rounded-[32px] p-5 md:p-7 flex flex-col gap-5 isolate pointer-events-auto">
                <header className="relative text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-black/[0.05] dark:bg-white/[0.10] flex items-center justify-center">
                    <Box className="w-6 h-6 text-neutral-800 dark:text-white" />
                  </div>
                  <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-neutral-900 dark:text-white">
                    Selecciona tu modelo
                  </h1>
                  <p className="mt-1 text-sm text-neutral-700 dark:text-white/75">
                    Elige una escena para comenzar a explorarla.
                  </p>
                </header>

                <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto min-h-0">
                  {DEMO_SCENES.map((scene, index) => (
                    <button
                      key={scene.name}
                      type="button"
                      disabled={backend === 'detecting' || isLoading}
                      onClick={() => void handleDemoSelect(scene.name)}
                      className="flex items-center gap-3 p-3 rounded-2xl border border-black/[0.08] dark:border-white/[0.14] bg-black/[0.03] dark:bg-white/[0.04] text-left hover:bg-black/[0.07] dark:hover:bg-white/[0.10] disabled:opacity-50 disabled:cursor-wait transition-colors"
                    >
                      <span className="w-9 h-9 shrink-0 rounded-full bg-black/[0.06] dark:bg-white/[0.10] flex items-center justify-center text-xs font-semibold tabular-nums text-neutral-800 dark:text-white/85">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-neutral-900 dark:text-white">
                          {scene.name}
                        </span>
                        <span className="block text-[10px] uppercase tracking-wider text-neutral-600 dark:text-white/60">
                          Modelo splat
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 shrink-0 text-neutral-600 dark:text-white/60" />
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={backend === 'detecting' || isLoading}
                  onClick={() => setShowUploader(true)}
                  className="relative flex items-center justify-center gap-2 h-11 shrink-0 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-white/90 disabled:opacity-50 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  <span className="text-xs font-semibold tracking-wider uppercase">Abrir archivo o URL</span>
                </button>
              </div>
            </section>
          )}

          {/* ── Right-side dock ── */}
          <nav
            aria-label="Herramientas del visor"
            className="absolute top-4 right-4 md:top-6 md:right-6 z-[25000] glass dock flex-col items-center isolate"
          >
            <button
              className="pill-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" strokeWidth={1.5} /> : <Moon className="w-4 h-4" strokeWidth={1.5} />}
            </button>
            <button
              className="pill-btn"
              onClick={() => void handleToggleFullscreen()}
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Poner en pantalla completa'}
              aria-pressed={isFullscreen}
              disabled={!document.fullscreenEnabled}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
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
});

export default Home;
