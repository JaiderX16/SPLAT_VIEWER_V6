import { useCallback, useEffect, useRef, useState } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

export interface LoadingProgress {
  percent: number;
  percentLabel: string;
  status: string;
  message: string;
}

export interface SceneInfo {
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

export interface ViewerOptions {
  cameraUp: [number, number, number];
  initialCameraPosition: [number, number, number];
  initialCameraLookAt: [number, number, number];
  gpuAcceleratedSort: boolean;
  sharedMemoryForWorkers: boolean;
  integerBasedSort: boolean;
  halfPrecisionCovariancesOnGPU: boolean;
  antialiased: boolean;
  splatRenderMode: GaussianSplats3D.SplatRenderMode;
  sceneRevealMode: GaussianSplats3D.SceneRevealMode;
  renderMode: GaussianSplats3D.RenderMode;
  logLevel: GaussianSplats3D.LogLevel;
  sphericalHarmonicsDegree: number;
  enableOptionalEffects: boolean;
  inMemoryCompressionLevel: number;
  freeIntermediateSplatData: boolean;
  progressiveLoad: boolean;
  splatAlphaRemovalThreshold: number;
}

const defaultOptions: ViewerOptions = {
  cameraUp: [0, 1, 0],
  initialCameraPosition: [0, 2, 10],
  initialCameraLookAt: [0, 0, 0],
  gpuAcceleratedSort: true,
  sharedMemoryForWorkers: true,
  integerBasedSort: true,
  halfPrecisionCovariancesOnGPU: false,
  antialiased: false,
  splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
  sceneRevealMode: GaussianSplats3D.SceneRevealMode.Default,
  renderMode: GaussianSplats3D.RenderMode.Always,
  logLevel: GaussianSplats3D.LogLevel.None,
  sphericalHarmonicsDegree: 0,
  enableOptionalEffects: false,
  inMemoryCompressionLevel: 0,
  freeIntermediateSplatData: false,
  progressiveLoad: true,
  splatAlphaRemovalThreshold: 1,
};

export function useGaussianSplats(containerRef: React.RefObject<HTMLDivElement | null>) {
  const viewerRef = useRef<GaussianSplats3D.Viewer | null>(null);
  const [progress, setProgress] = useState<LoadingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sceneInfo, setSceneInfo] = useState<SceneInfo | null>(null);
  const [hasScene, setHasScene] = useState(false);
  const animationFrameRef = useRef<number>(0);

  const createViewer = useCallback((options: Partial<ViewerOptions> = {}) => {
    if (!containerRef.current) return null;
    if (viewerRef.current) {
      viewerRef.current.dispose();
      viewerRef.current = null;
    }

    const opts = { ...defaultOptions, ...options };
    const viewer = new GaussianSplats3D.Viewer({
      rootElement: containerRef.current,
      cameraUp: opts.cameraUp,
      initialCameraPosition: opts.initialCameraPosition,
      initialCameraLookAt: opts.initialCameraLookAt,
      gpuAcceleratedSort: opts.gpuAcceleratedSort,
      sharedMemoryForWorkers: opts.sharedMemoryForWorkers,
      integerBasedSort: opts.integerBasedSort,
      halfPrecisionCovariancesOnGPU: opts.halfPrecisionCovariancesOnGPU,
      antialiased: opts.antialiased,
      splatRenderMode: opts.splatRenderMode,
      sceneRevealMode: opts.sceneRevealMode,
      renderMode: opts.renderMode,
      logLevel: opts.logLevel,
      sphericalHarmonicsDegree: opts.sphericalHarmonicsDegree,
      enableOptionalEffects: opts.enableOptionalEffects,
      inMemoryCompressionLevel: opts.inMemoryCompressionLevel,
      freeIntermediateSplatData: opts.freeIntermediateSplatData,
    });

    viewerRef.current = viewer;
    return viewer;
  }, [containerRef]);

  const loadScene = useCallback(async (path: string, options?: Partial<ViewerOptions> & { 
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
  }) => {
    if (!viewerRef.current) {
      createViewer(options);
    }
    const viewer = viewerRef.current;
    if (!viewer) return;

    setIsLoading(true);
    setProgress({ percent: 0, percentLabel: '0%', status: 'downloading', message: 'Starting download...' });

    try {
      const loadOptions = {
        splatAlphaRemovalThreshold: options?.splatAlphaRemovalThreshold ?? defaultOptions.splatAlphaRemovalThreshold,
        showLoadingUI: false,
        progressiveLoad: options?.progressiveLoad ?? defaultOptions.progressiveLoad,
        position: options?.position,
        rotation: options?.rotation,
        scale: options?.scale,
        onProgress: (percent: number, percentLabel: string, loaderStatus: number) => {
          let status = 'downloading';
          let message = `Downloading: ${percentLabel}`;
          if (loaderStatus === 1) {
            status = 'processing';
            message = 'Processing splats...';
          } else if (loaderStatus === 2) {
            status = 'done';
            message = 'Complete!';
          }
          if (percent >= 100 && loaderStatus === 0) {
            message = 'Download complete!';
          }
          setProgress({ percent, percentLabel, status, message });
        },
      };

      await viewer.addSplatScene(path, loadOptions);
      setHasScene(true);
      viewer.start();
    } catch (e) {
      console.error('Error loading scene:', e);
      setProgress({ percent: 0, percentLabel: '0%', status: 'error', message: 'Error loading scene' });
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  }, [createViewer]);

  const loadFile = useCallback(async (file: File, options?: Partial<ViewerOptions> & {
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
  }) => {
    const url = URL.createObjectURL(file);
    await loadScene(url, options);
    // URL.revokeObjectURL(url); // Keep alive while viewer uses it
  }, [loadScene]);

  const removeScene = useCallback(async (index: number = 0) => {
    if (!viewerRef.current) return;
    await viewerRef.current.removeSplatScene(index);
    setHasScene(false);
  }, []);

  const togglePointCloudMode = useCallback(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;
    const mesh = (viewer as any).splatMesh;
    if (mesh) {
      mesh.setPointCloudModeEnabled(!mesh.getPointCloudModeEnabled());
    }
  }, []);

  const setSplatScale = useCallback((scale: number) => {
    if (!viewerRef.current) return;
    const mesh = (viewerRef.current as any).splatMesh;
    if (mesh) {
      mesh.setSplatScale(scale);
    }
  }, []);

  const updateInfo = useCallback(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current as any;
    const mesh = viewer.splatMesh;
    if (!mesh) return;

    const splatCount = mesh.getSplatCount?.() || 0;
    const splatRenderCount = viewer.splatRenderCount || 0;
    const camera = viewer.camera;
    const controls = viewer.controls;

    setSceneInfo({
      splatCount,
      splatRenderCount,
      fps: viewer.currentFPS || null,
      cameraPosition: camera ? `${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}` : 'N/A',
      cameraLookAt: controls ? `${controls.target.x.toFixed(2)}, ${controls.target.y.toFixed(2)}, ${controls.target.z.toFixed(2)}` : 'N/A',
      cameraUp: camera ? `${camera.up.x.toFixed(2)}, ${camera.up.y.toFixed(2)}, ${camera.up.z.toFixed(2)}` : 'N/A',
      sortTime: viewer.lastSortTime || 0,
      splatScale: mesh.getSplatScale?.() || 1.0,
      pointCloudMode: mesh.getPointCloudModeEnabled?.() || false,
    });
  }, []);

  useEffect(() => {
    const loop = () => {
      updateInfo();
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [updateInfo]);

  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, []);

  return {
    viewerRef,
    progress,
    isLoading,
    hasScene,
    sceneInfo,
    createViewer,
    loadScene,
    loadFile,
    removeScene,
    togglePointCloudMode,
    setSplatScale,
  };
}
