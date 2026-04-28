import { useRef, useState, useCallback } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import GaussianSplatViewer, { type GaussianSplatViewerHandle } from '@/components/GaussianSplatViewer';
import ProgressiveLoader, { type ProgressiveLoadState } from '@/components/ProgressiveLoader';
import SceneUploader, { type LoadOptions } from '@/components/SceneUploader';
import InfoPanel from '@/components/InfoPanel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Upload,
  Trash2,
  Plus,
  Minus,
  Eye,
  EyeOff,
  Info,
  Settings2,
  MonitorPlay,
  Crosshair,
} from 'lucide-react';

const DEMO_SCENES = [
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

export default function Home() {
  const viewerRef = useRef<GaussianSplatViewerHandle>(null);
  const infoIntervalRef = useRef<ReturnType<typeof setInterval>>(null);

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
  const [showUploader, setShowUploader] = useState(false);
  const [pointCloudMode, setPointCloudMode] = useState(false);
  const [splatScale, setSplatScale] = useState(1.0);
  const [activeScene, setActiveScene] = useState<string>('');

  const updateSceneInfo = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rawViewer = viewer.viewer as any;
    if (!rawViewer) return;

    const mesh = rawViewer.splatMesh;
    const camera = rawViewer.camera;
    const controls = rawViewer.controls;

    if (!mesh || !camera) return;

    const splatCount = mesh.getSplatCount?.() || 0;
    const splatRenderCount = rawViewer.splatRenderCount || 0;

    setSceneInfo({
      splatCount,
      splatRenderCount,
      fps: rawViewer.currentFPS || null,
      cameraPosition: camera.position
        ? `${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}`
        : 'N/A',
      cameraLookAt: controls?.target
        ? `${controls.target.x.toFixed(2)}, ${controls.target.y.toFixed(2)}, ${controls.target.z.toFixed(2)}`
        : 'N/A',
      cameraUp: camera.up
        ? `${camera.up.x.toFixed(2)}, ${camera.up.y.toFixed(2)}, ${camera.up.z.toFixed(2)}`
        : 'N/A',
      sortTime: rawViewer.lastSortTime || 0,
      splatScale: mesh.getSplatScale?.() || 1.0,
      pointCloudMode: mesh.getPointCloudModeEnabled?.() || false,
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
    setProgressiveState({
      percent: 0,
      percentLabel: '0%',
      status: 'error',
      message: error.message || 'Failed to load scene',
    });
  }, []);

  const loadScene = useCallback(async (url: string, options?: Partial<LoadOptions>) => {
    if (!viewerRef.current) return;
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
    } catch (e) {
      handleError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [handleError]);

  const handleLoadFile = useCallback((file: File, options: LoadOptions) => {
    const url = URL.createObjectURL(file);
    loadScene(url, options);
  }, [loadScene]);

  const handleLoadURL = useCallback((url: string, options: LoadOptions) => {
    loadScene(url, options);
  }, [loadScene]);

  const handleRemoveScene = useCallback(async () => {
    if (!viewerRef.current) return;
    await viewerRef.current.removeSplatScene(0);
    setHasScene(false);
    setSceneInfo(null);
    stopInfoLoop();
    setActiveScene('');
  }, [stopInfoLoop]);

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
      format: scene.format as any,
    });
  }, [loadScene]);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-md border-b border-white/10 z-30">
        <div className="flex items-center gap-3">
          <MonitorPlay className="w-5 h-5 text-blue-400" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Gaussian Splats 3D Viewer</h1>
        </div>

        <div className="flex items-center gap-2">
          <Select value={activeScene} onValueChange={handleDemoSelect}>
            <SelectTrigger className="w-40 h-8 bg-white/10 border-white/20 text-white text-xs">
              <SelectValue placeholder="Demo scenes..." />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-white/20">
              {DEMO_SCENES.map((scene) => (
                <SelectItem key={scene.name} value={scene.name} className="text-white text-xs">
                  {scene.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={showUploader} onOpenChange={setShowUploader}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-white/70 hover:text-white hover:bg-white/10">
                <Upload className="w-4 h-4 mr-1" />
                Load
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-900 border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-white">Load Splat Scene</DialogTitle>
              </DialogHeader>
              <SceneUploader
                onLoadFile={handleLoadFile}
                onLoadURL={handleLoadURL}
                isLoading={isLoading}
              />
            </DialogContent>
          </Dialog>

          {hasScene && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetCamera}
                className="h-8 text-green-400 hover:text-green-300 hover:bg-green-400/10"
              >
                <Crosshair className="w-4 h-4 mr-1" />
                Focus
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleTogglePointCloud}
                className={`h-8 ${pointCloudMode ? 'text-amber-400 hover:text-amber-300 bg-amber-400/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
              >
                {pointCloudMode ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
                {pointCloudMode ? 'Points' : 'Splats'}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoveScene}
                className="h-8 text-red-400 hover:text-red-300 hover:bg-red-400/10"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Remove
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInfoVisible((v) => !v)}
            className={`h-8 ${infoVisible ? 'text-blue-400 hover:text-blue-300 bg-blue-400/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
          >
            <Info className="w-4 h-4 mr-1" />
            Info
          </Button>
        </div>
      </div>

      {/* Viewer Area */}
      <div className="flex-1 relative">
        <GaussianSplatViewer
          ref={viewerRef}
          onProgress={handleProgress}
          onLoadStart={handleLoadStart}
          onLoadComplete={handleLoadComplete}
          onError={handleError}
        />

        {/* Progressive Load Overlay */}
        <ProgressiveLoader state={progressiveState} />

        {/* Info Panel */}
        <InfoPanel info={sceneInfo} visible={infoVisible} onToggle={() => setInfoVisible((v) => !v)} />

        {/* Scale Control */}
        {hasScene && (
          <div className="absolute bottom-4 left-4 z-40 bg-black/70 backdrop-blur-md border border-white/10 rounded-xl p-3 flex items-center gap-3">
            <Settings2 className="w-4 h-4 text-white/50" />
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/70 hover:text-white"
                onClick={() => {
                  const next = Math.max(0.1, splatScale - 0.05);
                  setSplatScale(next);
                  viewerRef.current?.setSplatScale(next);
                }}
              >
                <Minus className="w-3 h-3" />
              </Button>
              <Slider
                value={[splatScale]}
                onValueChange={handleSplatScaleChange}
                min={0.1}
                max={3.0}
                step={0.05}
                className="w-32"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/70 hover:text-white"
                onClick={() => {
                  const next = Math.min(3.0, splatScale + 0.05);
                  setSplatScale(next);
                  viewerRef.current?.setSplatScale(next);
                }}
              >
                <Plus className="w-3 h-3" />
              </Button>
              <span className="text-white/60 text-xs font-mono w-10 text-right">{splatScale.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!hasScene && !isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-center space-y-4">
              <MonitorPlay className="w-16 h-16 mx-auto text-white/20" />
              <div>
                <h2 className="text-white/40 text-lg font-medium mb-1">No scene loaded</h2>
                <p className="text-white/25 text-sm">Select a demo scene or load your own .ply / .splat / .ksplat file</p>
              </div>
              <div className="flex items-center justify-center gap-2 pointer-events-auto">
                <Button
                  onClick={() => setShowUploader(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Load Scene
                </Button>
                <Select onValueChange={handleDemoSelect}>
                  <SelectTrigger className="w-40 bg-white/10 border-white/20 text-white">
                    <SelectValue placeholder="Demo scenes..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-white/20">
                    {DEMO_SCENES.map((scene) => (
                      <SelectItem key={scene.name} value={scene.name} className="text-white">
                        {scene.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
