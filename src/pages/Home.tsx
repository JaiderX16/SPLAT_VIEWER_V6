import { useRef, useState, useCallback, useEffect } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import GaussianSplatViewer, { type GaussianSplatViewerHandle, type CameraView } from '@/components/GaussianSplatViewer';
import ProgressiveLoader, { type ProgressiveLoadState } from '@/components/ProgressiveLoader';
import SceneUploader, { type LoadOptions } from '@/components/SceneUploader';
import InfoPanel from '@/components/InfoPanel';
import PerformanceBenchmarkPanel, { type PerformanceBenchmarkInfo } from '@/components/PerformanceBenchmarkPanel';
import AdvancedControlsPanel from '@/components/AdvancedControlsPanel';
import { estimateGaussianSplatVramMB, scoreBenchmark } from '@/lib/performanceBenchmark';
// @ts-expect-error Sidebar is authored in JS in this project.
import Sidebar from '@/components/Sidebar';
// @ts-expect-error SidebarMobileSheet is authored in JS in this project.
import SidebarMobileSheet from '@/components/SidebarMobileSheet';
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
} from 'lucide-react';

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

interface SceneInfo {
  splatCount: number;
  splatRenderCount: number;
  fps: number | null;
  cameraPosition: string;
  cameraLookAt: string;
  cameraUp: string;
  sortTime: number;
  splatScale: number;
  pointCloudMode: boolean;
}

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

interface BrowserCapabilities {
  webgl2: boolean;
  webgpu: boolean;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: number;
  };
}

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface RendererLike {
  domElement?: unknown;
  getPixelRatio?: () => number;
  info?: {
    render?: {
      calls?: number;
    };
  };
}

interface SplatMeshLike {
  renderer?: RendererLike;
  getSplatCount?: () => number;
  getSplatScale?: () => number;
  getPointCloudModeEnabled?: () => boolean;
}

interface RawViewerLike {
  renderer?: RendererLike;
  webGLRenderer?: RendererLike;
  threeRenderer?: RendererLike;
  splatMesh?: SplatMeshLike;
  camera?: {
    position?: Vector3Like;
    up?: Vector3Like;
  };
  controls?: {
    target?: Vector3Like;
  };
  currentFPS?: number | null;
  lastSortTime?: number;
  splatRenderCount?: number;
}

function readBrowserCapabilities(): BrowserCapabilities {
  const canvas = document.createElement('canvas');
  const webgl2 = Boolean(canvas.getContext('webgl2'));
  const webgpu = Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  return { webgl2, webgpu };
}

function readJSHeapMB(): number | null {
  const bytes = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  return typeof bytes === 'number' ? Math.round((bytes / 1024 / 1024) * 10) / 10 : null;
}

function getRenderer(rawViewer: RawViewerLike | null): RendererLike | null {
  return rawViewer?.renderer ?? rawViewer?.webGLRenderer ?? rawViewer?.threeRenderer ?? rawViewer?.splatMesh?.renderer ?? null;
}

function getRendererCanvas(renderer: RendererLike | null): HTMLCanvasElement | null {
  if (renderer?.domElement instanceof HTMLCanvasElement) return renderer.domElement;
  return document.querySelector<HTMLCanvasElement>('canvas');
}

export default function Home() {
  const viewerRef = useRef<GaussianSplatViewerHandle>(null);
  const infoIntervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const browserCapabilitiesRef = useRef<BrowserCapabilities | null>(null);

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
  const [mobileSheetState, setMobileSheetState] = useState('idle');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isMobile = useIsMobile();

  const revokeActiveObjectUrl = useCallback(() => {
    if (!activeObjectUrlRef.current) return;
    URL.revokeObjectURL(activeObjectUrlRef.current);
    activeObjectUrlRef.current = null;
  }, []);

  const updateSceneInfo = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rawViewer = viewer.viewer as RawViewerLike | null;
    if (!rawViewer) return;

    const mesh = rawViewer.splatMesh;
    const camera = rawViewer.camera;
    const controls = rawViewer.controls;

    if (!mesh || !camera) return;

    const splatCount = mesh.getSplatCount?.() || 0;
    const splatRenderCount = rawViewer.splatRenderCount || 0;
    const activeSplats = splatRenderCount > 0 ? splatRenderCount : splatCount;
    const fps = typeof rawViewer.currentFPS === 'number' ? rawViewer.currentFPS : null;
    const sortTimeMs = typeof rawViewer.lastSortTime === 'number' ? rawViewer.lastSortTime : 0;
    const renderer = getRenderer(rawViewer);
    const canvas = getRendererCanvas(renderer);
    const rendererPixelRatio = typeof renderer?.getPixelRatio === 'function' ? renderer.getPixelRatio() : null;
    const renderPixelRatio = canvas && canvas.clientWidth > 0
      ? Math.round((canvas.width / canvas.clientWidth) * 10) / 10
      : rendererPixelRatio;
    const canvasPixels = canvas ? canvas.width * canvas.height : null;
    const renderSize = canvas ? `${canvas.width}x${canvas.height}` : 'N/A';
    const rawDrawCalls = renderer?.info?.render?.calls;
    const drawCalls = typeof rawDrawCalls === 'number' ? rawDrawCalls : null;
    const estimatedVramMB = estimateGaussianSplatVramMB({
      totalSplats: splatCount,
      activeSplats,
      canvasPixels,
    });
    const capabilities = browserCapabilitiesRef.current ?? readBrowserCapabilities();
    browserCapabilitiesRef.current = capabilities;

    setSceneInfo({
      splatCount,
      splatRenderCount,
      fps,
      cameraPosition: camera.position
        ? `${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}`
        : 'N/A',
      cameraLookAt: controls?.target
        ? `${controls.target.x.toFixed(2)}, ${controls.target.y.toFixed(2)}, ${controls.target.z.toFixed(2)}`
        : 'N/A',
      cameraUp: camera.up
        ? `${camera.up.x.toFixed(2)}, ${camera.up.y.toFixed(2)}, ${camera.up.z.toFixed(2)}`
        : 'N/A',
      sortTime: sortTimeMs,
      splatScale: mesh.getSplatScale?.() || 1.0,
      pointCloudMode: mesh.getPointCloudModeEnabled?.() || false,
    });

    setBenchmarkInfo({
      fps,
      estimatedVramMB,
      jsHeapMB: readJSHeapMB(),
      totalSplats: splatCount,
      activeSplats,
      drawCalls,
      sortTimeMs,
      devicePixelRatio: window.devicePixelRatio || 1,
      renderPixelRatio,
      renderSize,
      webgl2: capabilities.webgl2,
      webgpu: capabilities.webgpu,
      score: scoreBenchmark({
        fps,
        estimatedVramMB,
        activeSplats,
        drawCalls,
        renderPixelRatio,
      }),
    });
  }, []);

  const startInfoLoop = useCallback(() => {
    if (infoIntervalRef.current) clearInterval(infoIntervalRef.current);
    infoIntervalRef.current = setInterval(updateSceneInfo, 200);
  }, [updateSceneInfo]);

  const stopInfoLoop = useCallback(() => {
    if (infoIntervalRef.current) {
      clearInterval(infoIntervalRef.current);
      infoIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopInfoLoop();
      revokeActiveObjectUrl();
    };
  }, [stopInfoLoop, revokeActiveObjectUrl]);

  const handleProgress = useCallback((percent: number, percentLabel: string, status: number) => {
    let stateStatus: ProgressiveLoadState['status'] = 'downloading';
    let message = `Downloading: ${percentLabel}`;

    if (status === 1) {
      stateStatus = 'processing';
      message = 'Processing splats...';
    } else if (status === 2) {
      stateStatus = 'done';
      message = 'Complete!';
    }
    if (percent >= 100 && status === 0) {
      message = 'Download complete!';
    }

    setProgressiveState({
      percent,
      percentLabel,
      status: stateStatus,
      message,
    });
  }, []);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
    setProgressiveState({
      percent: 0,
      percentLabel: '0%',
      status: 'downloading',
      message: 'Starting download...',
    });
  }, []);

  const handleLoadComplete = useCallback(() => {
    setIsLoading(false);
    setHasScene(true);
    setProgressiveState({
      percent: 100,
      percentLabel: '100%',
      status: 'done',
      message: 'Scene loaded!',
    });
    startInfoLoop();
    setTimeout(() => {
      setProgressiveState(prev => (prev.status === 'done' ? { ...prev, status: 'idle', message: '' } : prev));
    }, 2000);
  }, [startInfoLoop]);

  const handleError = useCallback((error: Error) => {
    console.error('Load error:', error);
    setIsLoading(false);
    setBenchmarkInfo(null);
    setProgressiveState({
      percent: 0,
      percentLabel: '0%',
      status: 'error',
      message: error.message || 'Failed to load scene',
    });
  }, []);

  const loadScene = useCallback(async (url: string, options?: Partial<LoadOptions>) => {
    if (!viewerRef.current) return;

    // Remove previous scene if one is already loaded
    try {
      if (viewerRef.current.getSceneCount() > 0) {
        await viewerRef.current.removeSplatScene(0);
        setHasScene(false);
        setSceneInfo(null);
        setBenchmarkInfo(null);
        stopInfoLoop();
      }
    } catch (e) {
      console.error('Error removing previous scene:', e);
    }

    setActiveScene(url);
    try {
      let formatEnum: GaussianSplats3D.SceneFormat | undefined;
      if (options?.format && options.format !== 'auto') {
        switch (options.format) {
          case 'ply': formatEnum = GaussianSplats3D.SceneFormat.Ply; break;
          case 'splat': formatEnum = GaussianSplats3D.SceneFormat.Splat; break;
          case 'ksplat': formatEnum = GaussianSplats3D.SceneFormat.KSplat; break;
          case 'spz': formatEnum = GaussianSplats3D.SceneFormat.Spz; break;
        }
      }
      await viewerRef.current.addSplatScene(url, {
        splatAlphaRemovalThreshold: options?.splatAlphaRemovalThreshold ?? 1,
        progressiveLoad: options?.progressiveLoad ?? true,
        position: options?.position,
        rotation: options?.rotation,
        scale: options?.scale,
        format: formatEnum,
      });
      viewerRef.current?.resetCamera();
    } catch (e) {
      handleError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [handleError, stopInfoLoop]);

  const handleLoadFile = useCallback(async (file: File, options: LoadOptions) => {
    const url = URL.createObjectURL(file);
    revokeActiveObjectUrl();
    activeObjectUrlRef.current = url;
    await loadScene(url, options);
    if (activeObjectUrlRef.current === url) {
      URL.revokeObjectURL(url);
      activeObjectUrlRef.current = null;
    }
  }, [loadScene, revokeActiveObjectUrl]);

  const handleLoadURL = useCallback((url: string, options: LoadOptions) => {
    revokeActiveObjectUrl();
    loadScene(url, options);
  }, [loadScene, revokeActiveObjectUrl]);

  const handleRemoveScene = useCallback(async () => {
    if (!viewerRef.current) return;
    await viewerRef.current.removeSplatScene(0);
    setHasScene(false);
    setSceneInfo(null);
    setBenchmarkInfo(null);
    stopInfoLoop();
    revokeActiveObjectUrl();
    setActiveScene('');
  }, [stopInfoLoop, revokeActiveObjectUrl]);

  const handleTogglePointCloud = useCallback(() => {
    const next = !pointCloudMode;
    setPointCloudMode(next);
    viewerRef.current?.setPointCloudMode(next);
  }, [pointCloudMode]);

  const handleSplatScaleChange = useCallback((value: number[]) => {
    const scale = value[0];
    setSplatScale(scale);
    viewerRef.current?.setSplatScale(scale);
  }, []);

  const handleResetCamera = useCallback(() => {
    viewerRef.current?.resetCamera();
  }, []);

  const handleDemoSelect = useCallback((sceneName: string) => {
    const scene = DEMO_SCENES.find((s) => s.name === sceneName);
    if (!scene || !viewerRef.current) return;
    loadScene(scene.url, {
      progressiveLoad: true,
      splatAlphaRemovalThreshold: 1,
      format: scene.format,
    });
    if (isMobile) {
      setMobileSheetState('idle');
    }
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
      if (view) {
        viewerRef.current?.setCameraView(view);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ─── Download progress line (minimalista, estilo referencia) ────────────────
  const downloading = progressiveState.status === 'downloading' || progressiveState.status === 'processing';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* ── Minimal top progress bar ── */}
      {downloading && (
        <div className="absolute top-0 left-0 right-0 z-[100] pointer-events-none">
          <div
            className="h-[3px] bg-sky-500 shadow-[0_0_8px_rgba(56,189,248,0.5)] transition-all duration-500 ease-out"
            style={{ width: `${Math.max(2, progressiveState.percent)}%` }}
          />
          {progressiveState.percent > 0 && (
            <div className="absolute top-2 left-4 px-2 py-1 bg-black/40 backdrop-blur-md border border-white/10 rounded-md">
              <span className="text-[10px] font-black tracking-widest uppercase text-sky-400">
                Cargando — {progressiveState.percent}%
              </span>
            </div>
          )}
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
          searchPlaceholder="Search scenes…"
        />
      )}

      {/* ── Uploader Dialog ── */}
      <Dialog open={showUploader} onOpenChange={setShowUploader}>
        <DialogContent className="bg-[#0f0f11] border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Cargar escena Splat</DialogTitle>
          </DialogHeader>
          <SceneUploader
            onLoadFile={handleLoadFile}
            onLoadURL={handleLoadURL}
            isLoading={isLoading}
          />
        </DialogContent>
      </Dialog>

      {/* ── Open sidebar button (desktop only) ── */}
      {!isMobile && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute top-6 left-6 z-[300] w-12 h-12 rounded-full bg-[#1a1a1e]/70 backdrop-blur-[28px] border border-white/[0.08] text-white/50 flex items-center justify-center hover:bg-white/10 hover:text-white/80 transition-all duration-150 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
          title="Mostrar panel"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* ── Main Viewer ── */}
      <main className="absolute inset-0">
        <GaussianSplatViewer
          ref={viewerRef}
          onProgress={handleProgress}
          onLoadStart={handleLoadStart}
          onLoadComplete={handleLoadComplete}
          onError={handleError}
        />

        {/* Progressive Load Overlay (mantenido por si acaso) */}
        <ProgressiveLoader state={progressiveState} />

        {/* Info Panel */}
        <InfoPanel info={sceneInfo} visible={infoVisible} onToggle={() => setInfoVisible((v) => !v)} />

        {/* Benchmark Panel */}
        <PerformanceBenchmarkPanel info={benchmarkInfo} visible={benchmarkVisible} />

        {/* Scale Control */}
        {hasScene && (
          <div className="absolute bottom-4 left-4 z-40 bg-black/70 backdrop-blur-md border border-white/10 rounded-full h-14 px-5 flex items-center gap-4">
            <Settings2 className="w-4 h-4 text-white/50" />
            <div className="flex items-center gap-2">
              <button
                className="w-7 h-7 flex items-center justify-center text-white/40 hover:text-white transition-colors"
                onClick={() => {
                  const next = Math.max(0.1, splatScale - 0.05);
                  setSplatScale(next);
                  viewerRef.current?.setSplatScale(next);
                }}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <Slider
                value={[splatScale]}
                onValueChange={handleSplatScaleChange}
                min={0.1}
                max={3.0}
                step={0.05}
                className="w-44"
              />
              <button
                className="w-7 h-7 flex items-center justify-center text-white/40 hover:text-white transition-colors"
                onClick={() => {
                  const next = Math.min(3.0, splatScale + 0.05);
                  setSplatScale(next);
                  viewerRef.current?.setSplatScale(next);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="text-white/60 text-xs font-mono w-10 text-right">{splatScale.toFixed(2)}</span>
            </div>
          </div>
        )}
      </main>

      {/* ── Right-side floating buttons ── */}
      <div className="absolute top-6 right-6 z-[25000] flex flex-col items-center gap-3">
        {/* Focus / Reset */}
        <button
          className="w-12 h-12 rounded-full border border-white/10 bg-black/50 backdrop-blur-xl text-white/50 flex items-center justify-center hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-150"
          onClick={handleResetCamera}
          title="Enfocar escena"
        >
          <Crosshair className="w-4 h-4" />
        </button>

        {/* Benchmark */}
        <button
          className={`w-12 h-12 rounded-full border border-white/10 backdrop-blur-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150 ${
            benchmarkVisible
              ? 'text-sky-300 bg-sky-400/10 border-sky-400/30'
              : 'text-white/50 bg-black/50 hover:bg-white/10 hover:text-white'
          }`}
          onClick={() => {
            const next = !benchmarkVisible;
            setBenchmarkVisible(next);
            if (next) setInfoVisible(false);
          }}
          title="Benchmark 2026"
          aria-pressed={benchmarkVisible}
        >
          <Activity className="w-4 h-4" />
        </button>

        {/* Points / Splats */}
        <button
          className={`w-12 h-12 rounded-full border border-white/10 backdrop-blur-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150 ${
            pointCloudMode
              ? 'text-amber-400 bg-amber-400/10 border-amber-400/30'
              : 'text-white/50 bg-black/50 hover:bg-white/10 hover:text-white'
          }`}
          onClick={handleTogglePointCloud}
          title={pointCloudMode ? 'Modo puntos' : 'Modo splats'}
        >
          {pointCloudMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>

        {/* Remove */}
        {hasScene && (
          <button
            className="w-12 h-12 rounded-full border border-white/10 bg-black/50 backdrop-blur-xl text-white/50 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 hover:scale-105 active:scale-95 transition-all duration-150"
            onClick={handleRemoveScene}
            title="Eliminar escena"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Info */}
        <button
          className={`w-12 h-12 rounded-full border border-white/10 backdrop-blur-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150 ${
            infoVisible
              ? 'text-blue-400 bg-blue-400/10 border-blue-400/30'
              : 'text-white/50 bg-black/50 hover:bg-white/10 hover:text-white'
          }`}
          onClick={() => {
            const next = !infoVisible;
            setInfoVisible(next);
            if (next) setBenchmarkVisible(false);
          }}
          title="Información"
        >
          <Info className="w-4 h-4" />
        </button>

        {/* Advanced controls */}
        <button
          className={`w-12 h-12 rounded-full border border-white/10 backdrop-blur-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150 ${
            advancedOpen
              ? 'text-violet-300 bg-violet-400/10 border-violet-400/30'
              : 'text-white/50 bg-black/50 hover:bg-white/10 hover:text-white'
          }`}
          onClick={() => setAdvancedOpen((v) => !v)}
          title="Controles avanzados"
          aria-pressed={advancedOpen}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* ── Advanced controls panel ── */}
      <AdvancedControlsPanel
        viewerRef={viewerRef}
        visible={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
      />
    </div>
  );
}
