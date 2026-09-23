import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

// True when SharedArrayBuffer is available (page is cross-origin isolated).
function isSharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';
}

// ─── Camera settings (replicados del proyecto de referencia) ─────────────────
const CAMERA = {
  DIST_FAR: 5.0,
  DIST_NEAR: 2.3,
  UP: [0, -1, 0] as [number, number, number],
  INITIAL_POSITION: [0, -2.4, 4.4] as [number, number, number],
  LOOK_AT: [0, 0, 0] as [number, number, number],
  MIN_DISTANCE: 0.5,
  MAX_DISTANCE: 20,
  // Near-full free orbit (SuperSplat-style), with a tiny margin to avoid the
  // gimbal-lock dead zone directly above/below the target.
  MIN_POLAR_ANGLE: Math.PI * 0.02,
  MAX_POLAR_ANGLE: Math.PI * 0.98,
};

const VIEW_DIRECTIONS: Record<Exclude<CameraView, 'reset'>, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

const VIEW_UPS: Record<Exclude<CameraView, 'reset'>, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, -1, 0],
  left: [0, -1, 0],
  right: [0, -1, 0],
  top: [0, 0, -1],
  bottom: [0, 0, 1],
};

const ROTATION = {
  SPEED_FAST: 4.0,
};

const DAMPING = {
  FACTOR: 0.04,
  ENABLED: true,
};

const ANIMATION = {
  INTRO_ZOOM_DURATION: 4000,
};

/** Named camera viewpoints, mirroring SuperSplat-style view presets. */
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'reset';

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
  setOrthographicMode: (enabled: boolean) => void;
  getOrthographicMode: () => boolean;
  setFov: (fov: number) => void;
  getFov: () => number;
  setBackgroundColor: (color: string) => void;
  setGridVisible: (visible: boolean) => void;
  setAxesVisible: (visible: boolean) => void;
  setCameraView: (view: CameraView) => void;
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
    cameraUp = CAMERA.UP,
    initialCameraPosition = CAMERA.INITIAL_POSITION,
    initialCameraLookAt = CAMERA.LOOK_AT,
    logLevel = GaussianSplats3D.LogLevel.None,
    sphericalHarmonicsDegree = 0,
  }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<GaussianSplats3D.Viewer | null>(null);
    const gridHelperRef = useRef<THREE.GridHelper | null>(null);
    const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
    const isRunningRef = useRef(false);
    const onProgressRef = useRef(onProgress);
    const onLoadStartRef = useRef(onLoadStart);
    const onLoadCompleteRef = useRef(onLoadComplete);
    const onErrorRef = useRef(onError);
    const introRafRef = useRef<number | null>(null);

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
        sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
        gpuAcceleratedSort: false,
        // Zero-copy sort buffer when the page is cross-origin isolated; the
        // guard degrades gracefully to copy-based worker sorting otherwise.
        // This only speeds up sorting and has no effect on visual quality.
        sharedMemoryForWorkers: isSharedArrayBufferAvailable(),
        integerBasedSort: true,
        halfPrecisionCovariancesOnGPU: false,
        antialiased: false,
        splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
        renderMode: GaussianSplats3D.RenderMode.Always,
        logLevel,
        sphericalHarmonicsDegree,
        enableOptionalEffects: false,
        inMemoryCompressionLevel: 0,
        freeIntermediateSplatData: false,
      });

      viewerRef.current = viewer;

      // ── Controls configuration (replicado exactamente) ─────────────────────
      if (viewer.controls) {
        const c = viewer.controls as any;
        c.enableDamping = DAMPING.ENABLED;
        c.dampingFactor = DAMPING.FACTOR;
        c.minPolarAngle = CAMERA.MIN_POLAR_ANGLE;
        c.maxPolarAngle = CAMERA.MAX_POLAR_ANGLE;
        c.minDistance = CAMERA.DIST_FAR;
        c.maxDistance = CAMERA.DIST_FAR;
        c.autoRotate = true;
        c.autoRotateSpeed = ROTATION.SPEED_FAST;
      }

      if (!isRunningRef.current) {
        viewer.start();
        isRunningRef.current = true;
      }

      return () => {
        if (introRafRef.current) {
          cancelAnimationFrame(introRafRef.current);
          introRafRef.current = null;
        }
        const disposeHelper = (obj: THREE.Object3D | null) => {
          if (!obj) return;
          const anyObj = obj as any;
          anyObj.geometry?.dispose?.();
          const materials = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
          materials.forEach((m: any) => m?.dispose?.());
        };
        disposeHelper(gridHelperRef.current);
        disposeHelper(axesHelperRef.current);
        gridHelperRef.current = null;
        axesHelperRef.current = null;
        // dispose() is async – its .finally() may try removeChild on a node
        // that React already unmounted (StrictMode double-invoke).
        viewer.dispose().catch(() => {});
        viewerRef.current = null;
        isRunningRef.current = false;
      };
    }, []);

    const runIntroZoom = (viewer: any) => {
      if (!viewer?.controls) return;
      const introStart = performance.now();
      const tick = () => {
        if (!viewer.controls) return;
        const t = Math.min((performance.now() - introStart) / ANIMATION.INTRO_ZOOM_DURATION, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const dist = CAMERA.DIST_FAR + (CAMERA.DIST_NEAR - CAMERA.DIST_FAR) * ease;
        viewer.controls.minDistance = dist;
        viewer.controls.maxDistance = dist;
        if (t < 1) {
          introRafRef.current = requestAnimationFrame(tick);
        } else {
          viewer.controls.minDistance = CAMERA.MIN_DISTANCE;
          viewer.controls.maxDistance = CAMERA.MAX_DISTANCE;
          introRafRef.current = null;
        }
      };
      introRafRef.current = requestAnimationFrame(tick);
    };

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
            progressiveLoad: options.progressiveLoad ?? true,
            onProgress: (percent: number, percentLabel: string, loaderStatus: number) => {
              onProgressRef.current?.(percent, percentLabel, loaderStatus);
            },
          };

          await viewer.addSplatScene(path, loadOptions);

          if (!isRunningRef.current) {
            viewer.start();
            isRunningRef.current = true;
          }

          runIntroZoom(viewer);
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
            progressiveLoad: opt.progressiveLoad ?? true,
          }));

          await viewer.addSplatScenes(options, showLoadingUI, (percent: number, percentLabel: string, loaderStatus: number) => {
            onProgressRef.current?.(percent, percentLabel, loaderStatus);
          });

          if (!isRunningRef.current) {
            viewer.start();
            isRunningRef.current = true;
          }

          runIntroZoom(viewer);
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
        if (!v || !v.controls || !v.camera) return;
        v.controls.target.set(0, 0, 0);
        v.camera.position.set(
          CAMERA.INITIAL_POSITION[0],
          CAMERA.INITIAL_POSITION[1],
          CAMERA.INITIAL_POSITION[2]
        );
        v.camera.lookAt(0, 0, 0);
        v.camera.up.set(CAMERA.UP[0], CAMERA.UP[1], CAMERA.UP[2]);
        v.controls.update();
        v.forceRenderNextFrame?.();
      },
      setOrthographicMode: (enabled: boolean) => {
        const v = viewerRef.current as any;
        if (!v) return;
        v.setOrthographicMode?.(enabled);
        v.forceRenderNextFrame?.();
      },
      getOrthographicMode: () => {
        const v = viewerRef.current as any;
        return v?.camera?.isOrthographicCamera ?? false;
      },
      setFov: (fov: number) => {
        const v = viewerRef.current as any;
        const cam = v?.perspectiveCamera;
        if (!cam) return;
        cam.fov = THREE.MathUtils.clamp(fov, 10, 120);
        cam.updateProjectionMatrix();
        v.forceRenderNextFrame?.();
      },
      getFov: () => {
        const v = viewerRef.current as any;
        return v?.perspectiveCamera?.fov ?? 50;
      },
      setBackgroundColor: (color: string) => {
        const v = viewerRef.current as any;
        if (v?.renderer) {
          v.renderer.setClearColor(new THREE.Color(color), 1);
          v.forceRenderNextFrame?.();
        }
      },
      setGridVisible: (visible: boolean) => {
        const v = viewerRef.current as any;
        if (!v?.threeScene) return;
        if (!gridHelperRef.current) {
          gridHelperRef.current = new THREE.GridHelper(10, 20, 0x888888, 0x2a2a2a);
          gridHelperRef.current.position.y = 0;
          v.threeScene.add(gridHelperRef.current);
        }
        gridHelperRef.current.visible = visible;
        v.forceRenderNextFrame?.();
      },
      setAxesVisible: (visible: boolean) => {
        const v = viewerRef.current as any;
        if (!v?.threeScene) return;
        if (!axesHelperRef.current) {
          axesHelperRef.current = new THREE.AxesHelper(1);
          v.threeScene.add(axesHelperRef.current);
        }
        axesHelperRef.current.visible = visible;
        v.forceRenderNextFrame?.();
      },
      setCameraView: (view: CameraView) => {
        const v = viewerRef.current as any;
        if (!v?.camera || !v?.controls) return;
        const controls = v.controls;
        const target = controls.target;

        if (view === 'reset') {
          target.set(0, 0, 0);
          v.camera.position.set(
            CAMERA.INITIAL_POSITION[0],
            CAMERA.INITIAL_POSITION[1],
            CAMERA.INITIAL_POSITION[2],
          );
          v.camera.up.set(CAMERA.UP[0], CAMERA.UP[1], CAMERA.UP[2]);
        } else {
          const distance = Math.max(v.camera.position.distanceTo(target), 2.5);
          const dir = VIEW_DIRECTIONS[view];
          const up = VIEW_UPS[view];
          v.camera.position.set(
            target.x + dir[0] * distance,
            target.y + dir[1] * distance,
            target.z + dir[2] * distance,
          );
          v.camera.up.set(up[0], up[1], up[2]);
        }

        v.camera.lookAt(target);
        controls.update();
        v.forceRenderNextFrame?.();
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
