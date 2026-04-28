import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

export interface GaussianSplatViewerHandle {
  viewer: GaussianSplats3D.Viewer | null;
  addSplatScene: (path: string, options?: any) => Promise<void>;
  addSplatScenes: (sceneOptions: any[], showLoadingUI?: boolean) => Promise<void>;
  removeSplatScene: (index: number) => Promise<void>;
  removeSplatScenes: (indexes: number[]) => Promise<void>;
  start: () => void;
  stop: () => void;
  dispose: () => Promise<void>;
  setPointCloudMode: (enabled: boolean) => void;
  setSplatScale: (scale: number) => void;
  setActiveSphericalHarmonicsDegrees: (degree: number) => void;
  getSplatScene: (index: number) => any;
  getSceneCount: () => number;
  resetCamera: () => void;
}

interface GaussianSplatViewerProps {
  className?: string;
  onProgress?: (percent: number, percentLabel: string, status: number) => void;
  onLoadStart?: () => void;
  onLoadComplete?: () => void;
  onError?: (error: Error) => void;
  cameraUp?: [number, number, number];
  initialCameraPosition?: [number, number, number];
  initialCameraLookAt?: [number, number, number];
  logLevel?: GaussianSplats3D.LogLevel;
  sphericalHarmonicsDegree?: number;
}

const GaussianSplatViewer = forwardRef<GaussianSplatViewerHandle, GaussianSplatViewerProps>(
  ({
    className = '',
    onProgress,
    onLoadStart,
    onLoadComplete,
    onError,
    cameraUp = [0, -1, -0.6],
    initialCameraPosition = [-1, -4, 6],
    initialCameraLookAt = [0, 4, 0],
    logLevel = GaussianSplats3D.LogLevel.None,
    sphericalHarmonicsDegree = 0,
  }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<GaussianSplats3D.Viewer | null>(null);
    const isRunningRef = useRef(false);
    const onProgressRef = useRef(onProgress);
    const onLoadStartRef = useRef(onLoadStart);
    const onLoadCompleteRef = useRef(onLoadComplete);
    const onErrorRef = useRef(onError);

    useEffect(() => {
      onProgressRef.current = onProgress;
      onLoadStartRef.current = onLoadStart;
      onLoadCompleteRef.current = onLoadComplete;
      onErrorRef.current = onError;
    }, [onProgress, onLoadStart, onLoadComplete, onError]);

    useEffect(() => {
      if (!containerRef.current) return;

      const viewer = new GaussianSplats3D.Viewer({
        rootElement: containerRef.current,
        cameraUp,
        initialCameraPosition,
        initialCameraLookAt,
        selfDrivenMode: true,
        useBuiltInControls: true,
        gpuAcceleratedSort: false,
        sharedMemoryForWorkers: false,
        integerBasedSort: true,
        halfPrecisionCovariancesOnGPU: false,
        antialiased: false,
        splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
        sceneRevealMode: GaussianSplats3D.SceneRevealMode.Default,
        renderMode: GaussianSplats3D.RenderMode.Always,
        logLevel,
        sphericalHarmonicsDegree,
        enableOptionalEffects: false,
        inMemoryCompressionLevel: 0,
        freeIntermediateSplatData: false,
      });

      viewerRef.current = viewer;

      if (!isRunningRef.current) {
        viewer.start();
        isRunningRef.current = true;
      }

      return () => {
        viewer.dispose();
        viewerRef.current = null;
        isRunningRef.current = false;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      get viewer() {
        return viewerRef.current;
      },
      addSplatScene: async (path: string, options: any = {}) => {
        const viewer = viewerRef.current;
        if (!viewer) throw new Error('Viewer not initialized');

        onLoadStartRef.current?.();

        try {
          const loadOptions = {
            ...options,
            showLoadingUI: false,
            onProgress: (percent: number, percentLabel: string, loaderStatus: number) => {
              onProgressRef.current?.(percent, percentLabel, loaderStatus);
            },
          };

          await viewer.addSplatScene(path, loadOptions);

          if (!isRunningRef.current) {
            viewer.start();
            isRunningRef.current = true;
          }

          onLoadCompleteRef.current?.();
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          onErrorRef.current?.(error);
          throw error;
        }
      },
      addSplatScenes: async (sceneOptions: any[], showLoadingUI = true) => {
        const viewer = viewerRef.current;
        if (!viewer) throw new Error('Viewer not initialized');

        onLoadStartRef.current?.();

        try {
          const options = sceneOptions.map((opt) => ({
            ...opt,
            showLoadingUI: false,
          }));

          await viewer.addSplatScenes(options, showLoadingUI, (percent: number, percentLabel: string, loaderStatus: number) => {
            onProgressRef.current?.(percent, percentLabel, loaderStatus);
          });

          if (!isRunningRef.current) {
            viewer.start();
            isRunningRef.current = true;
          }

          onLoadCompleteRef.current?.();
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          onErrorRef.current?.(error);
          throw error;
        }
      },
      removeSplatScene: async (index: number) => {
        const viewer = viewerRef.current;
        if (!viewer) throw new Error('Viewer not initialized');
        return viewer.removeSplatScene(index);
      },
      removeSplatScenes: async (indexes: number[]) => {
        const viewer = viewerRef.current;
        if (!viewer) throw new Error('Viewer not initialized');
        return viewer.removeSplatScenes(indexes);
      },
      start: () => {
        if (!isRunningRef.current) {
          viewerRef.current?.start();
          isRunningRef.current = true;
        }
      },
      stop: () => {
        viewerRef.current?.stop();
        isRunningRef.current = false;
      },
      dispose: async () => {
        return viewerRef.current?.dispose() || Promise.resolve();
      },
      setPointCloudMode: (enabled: boolean) => {
        const viewer = viewerRef.current as any;
        if (viewer?.splatMesh) {
          viewer.splatMesh.setPointCloudModeEnabled(enabled);
        }
      },
      setSplatScale: (scale: number) => {
        const viewer = viewerRef.current as any;
        if (viewer?.splatMesh) {
          viewer.splatMesh.setSplatScale(scale);
        }
      },
      setActiveSphericalHarmonicsDegrees: (degree: number) => {
        viewerRef.current?.setActiveSphericalHarmonicsDegrees(degree);
      },
      getSplatScene: (index: number) => {
        const viewer = viewerRef.current as any;
        return viewer?.splatMesh?.scenes?.[index] || null;
      },
      getSceneCount: () => {
        const viewer = viewerRef.current as any;
        return viewer?.splatMesh?.scenes?.length || 0;
      },
      resetCamera: () => {
        const v = viewerRef.current as any;
        if (!v || !v.splatMesh || !v.splatMesh.scenes || v.splatMesh.scenes.length === 0) return;

        const scene = v.splatMesh.scenes[0];
        if (!scene) return;

        const scenePos = scene.position;
        const target = new THREE.Vector3(scenePos.x, scenePos.y, scenePos.z);

        if (v.camera && v.controls) {
          v.controls.target.copy(target);
          v.camera.position.copy(target).add(new THREE.Vector3(0, 0, 10));
          v.camera.lookAt(target);
          v.camera.up.copy(new THREE.Vector3().fromArray(cameraUp)).normalize();
          v.controls.update();
          v.forceRenderNextFrame?.();
        }
      },
    }), []);

    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full overflow-hidden ${className}`}
        style={{ background: '#000', minWidth: '100%', minHeight: '100%' }}
      />
    );
  }
);

GaussianSplatViewer.displayName = 'GaussianSplatViewer';

export default GaussianSplatViewer;
