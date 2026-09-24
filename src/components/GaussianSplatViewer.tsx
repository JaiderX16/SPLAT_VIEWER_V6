import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { EditorOverlay, type OverlayViewerHost } from '@/lib/editorOverlay';

// ─── Camera settings (replicados del proyecto de referencia) ─────────────────
const CAMERA = {
  UP: [0, -1, 0] as [number, number, number],
  INITIAL_POSITION: [0, -2.4, 4.4] as [number, number, number],
  LOOK_AT: [0, 0, 0] as [number, number, number],
  MIN_DISTANCE: 0.5,
  MAX_DISTANCE: 20,
  // Keep the camera from going too far above/below the model (which put it at
  // "ground level" and made navigation disorienting).
  MIN_POLAR_ANGLE: Math.PI * 0.10,
  MAX_POLAR_ANGLE: Math.PI * 0.82,
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
  SPEED_INTRO: 2.2,
  SPEED_SLOW: 0.8,
};

const DAMPING = {
  FACTOR: 0.04,
  ENABLED: true,
};

const ANIMATION = {
  INTRO_DURATION: 6000,
  INTRO_START_DISTANCE: 9.0,
  INTRO_END_DISTANCE: 2.6,
};

/** Named camera viewpoints, mirroring SuperSplat-style view presets. */
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'reset';

interface ViewerControlsLike {
  enableDamping: boolean;
  dampingFactor: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  minDistance: number;
  maxDistance: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (event: string, listener: () => void) => void;
}

interface ViewerInternalLike {
  controls?: ViewerControlsLike;
  camera?: THREE.Camera & {
    isOrthographicCamera?: boolean;
    position: THREE.Vector3;
    up: THREE.Vector3;
    lookAt: (target: THREE.Vector3 | [number, number, number]) => void;
  };
  perspectiveCamera?: THREE.PerspectiveCamera;
  renderer?: THREE.WebGLRenderer;
  threeScene?: THREE.Scene;
  splatMesh?: {
    scenes?: unknown[];
    setPointCloudModeEnabled: (enabled: boolean) => void;
    setSplatScale: (scale: number) => void;
  };
  forceRenderNextFrame?: () => void;
  setOrthographicMode?: (enabled: boolean) => void;
}

export interface GaussianSplatViewerHandle {
  viewer: GaussianSplats3D.Viewer | null;
  addSplatScene: (path: string, options?: Record<string, unknown>) => Promise<void>;
  addSplatScenes: (sceneOptions: Record<string, unknown>[], showLoadingUI?: boolean) => Promise<void>;
  removeSplatScene: (index: number) => Promise<void>;
  removeSplatScenes: (indexes: number[]) => Promise<void>;
  start: () => void;
  stop: () => void;
  dispose: () => Promise<void>;
  setPointCloudMode: (enabled: boolean) => void;
  setSplatScale: (scale: number) => void;
  setActiveSphericalHarmonicsDegrees: (degree: number) => void;
  getSplatScene: (index: number) => unknown;
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
  setEditorViewVisible: (visible: boolean) => void;
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
    const editorOverlayRef = useRef<EditorOverlay | null>(null);
    const gridHelperRef = useRef<THREE.GridHelper | null>(null);
    const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
    const isRunningRef = useRef(false);
    const onProgressRef = useRef(onProgress);
    const onLoadStartRef = useRef(onLoadStart);
    const onLoadCompleteRef = useRef(onLoadComplete);
    const onErrorRef = useRef(onError);
    const introRafRef = useRef<number | null>(null);

    const initPropsRef = useRef({
      cameraUp,
      initialCameraPosition,
      initialCameraLookAt,
      logLevel,
      sphericalHarmonicsDegree,
    });

    useEffect(() => {
      onProgressRef.current = onProgress;
      onLoadStartRef.current = onLoadStart;
      onLoadCompleteRef.current = onLoadComplete;
      onErrorRef.current = onError;
    }, [onProgress, onLoadStart, onLoadComplete, onError]);

    useEffect(() => {
      if (!containerRef.current) return;

      const initProps = initPropsRef.current;
      const viewer = new GaussianSplats3D.Viewer({
        rootElement: containerRef.current,
        cameraUp: initProps.cameraUp,
        initialCameraPosition: initProps.initialCameraPosition,
        initialCameraLookAt: initProps.initialCameraLookAt,
        selfDrivenMode: true,
        useBuiltInControls: true,
        sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
        gpuAcceleratedSort: false,
        // Copy-based worker sorting (matches the fast reference build).
        sharedMemoryForWorkers: false,
        integerBasedSort: true,
        halfPrecisionCovariancesOnGPU: false,
        antialiased: false,
        splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
        renderMode: GaussianSplats3D.RenderMode.Always,
        logLevel: initProps.logLevel,
        sphericalHarmonicsDegree: initProps.sphericalHarmonicsDegree,
        enableOptionalEffects: false,
        inMemoryCompressionLevel: 0,
        freeIntermediateSplatData: false,
      });

      viewerRef.current = viewer;

      // ── Controls configuration (replicado exactamente) ─────────────────────
      const internalControls = (viewer as unknown as ViewerInternalLike).controls;
      if (internalControls) {
        internalControls.enableDamping = DAMPING.ENABLED;
        internalControls.dampingFactor = DAMPING.FACTOR;
        internalControls.minPolarAngle = CAMERA.MIN_POLAR_ANGLE;
        internalControls.maxPolarAngle = CAMERA.MAX_POLAR_ANGLE;
        internalControls.minDistance = CAMERA.MIN_DISTANCE;
        internalControls.maxDistance = CAMERA.MAX_DISTANCE;
        internalControls.autoRotate = true;
        internalControls.autoRotateSpeed = ROTATION.SPEED_INTRO;
        // Stop the auto-orbit (and cancel the entrance) the moment the user
        // grabs the scene, so it never fights the user's input.
        internalControls.addEventListener('start', () => {
          internalControls.autoRotate = false;
          if (introRafRef.current !== null) {
            cancelAnimationFrame(introRafRef.current);
            introRafRef.current = null;
          }
          internalControls.minDistance = CAMERA.MIN_DISTANCE;
          internalControls.maxDistance = CAMERA.MAX_DISTANCE;
        });
      }

      // ── Editor view overlay (picture-in-picture debug view) ────────────────
      const editorOverlay = new EditorOverlay(viewer as unknown as OverlayViewerHost);
      editorOverlay.enable();
      editorOverlayRef.current = editorOverlay;

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
          if ('geometry' in obj && obj.geometry instanceof THREE.BufferGeometry) {
            obj.geometry.dispose();
          }
          if ('material' in obj) {
            const raw = (obj as { material: unknown }).material;
            const materials = Array.isArray(raw) ? raw : [raw];
            materials.forEach((m) => {
              if (m && typeof m === 'object' && 'dispose' in m && typeof (m as { dispose: () => void }).dispose === 'function') {
                (m as { dispose: () => void }).dispose();
              }
            });
          }
        };
        disposeHelper(gridHelperRef.current);
        disposeHelper(axesHelperRef.current);
        gridHelperRef.current = null;
        axesHelperRef.current = null;
        editorOverlayRef.current?.dispose();
        editorOverlayRef.current = null;
        // dispose() is async – its .finally() may try removeChild on a node
        // that React already unmounted (StrictMode double-invoke).
        viewer.dispose().catch(() => {});
        viewerRef.current = null;
        isRunningRef.current = false;
      };
    }, []);

    const runIntroAnimation = (viewer: GaussianSplats3D.Viewer) => {
      const v = viewer as unknown as ViewerInternalLike;
      const controls = v.controls;
      const camera = v.camera;
      if (!controls || !camera) return;

      if (introRafRef.current !== null) {
        cancelAnimationFrame(introRafRef.current);
        introRafRef.current = null;
      }

      // Start the cinematic entrance from a far vantage point, then glide in
      // while slowly orbiting, to showcase the place.
      const viewDir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(viewDir, ANIMATION.INTRO_START_DISTANCE);
      camera.lookAt(controls.target);
      controls.autoRotate = true;
      controls.autoRotateSpeed = ROTATION.SPEED_INTRO;

      const introStart = performance.now();
      const tick = () => {
        if (!controls) return;
        const t = Math.min((performance.now() - introStart) / ANIMATION.INTRO_DURATION, 1);
        // ease-in-out cubic for a clean, cinematic motion.
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const dist = ANIMATION.INTRO_START_DISTANCE +
          (ANIMATION.INTRO_END_DISTANCE - ANIMATION.INTRO_START_DISTANCE) * ease;
        controls.minDistance = dist;
        controls.maxDistance = dist;
        if (t < 1) {
          introRafRef.current = requestAnimationFrame(tick);
        } else {
          // Entrance finished: settle into a slow, smooth orbit.
          controls.minDistance = CAMERA.MIN_DISTANCE;
          controls.maxDistance = CAMERA.MAX_DISTANCE;
          controls.autoRotateSpeed = ROTATION.SPEED_SLOW;
          controls.update();
          introRafRef.current = null;
        }
      };
      introRafRef.current = requestAnimationFrame(tick);
    };

    useImperativeHandle(ref, () => ({
      get viewer() {
        return viewerRef.current;
      },
      addSplatScene: async (path: string, options: Record<string, unknown> = {}) => {
        const viewer = viewerRef.current;
        if (!viewer) throw new Error('Viewer not initialized');

        onLoadStartRef.current?.();

        try {
          const loadOptions = {
            ...options,
            showLoadingUI: false,
            progressiveLoad: (options.progressiveLoad as boolean | undefined) ?? true,
            onProgress: (percent: number, percentLabel: string, loaderStatus: number) => {
              onProgressRef.current?.(percent, percentLabel, loaderStatus);
            },
          };

          await viewer.addSplatScene(path, loadOptions);

          if (!isRunningRef.current) {
            viewer.start();
            isRunningRef.current = true;
          }

          runIntroAnimation(viewer);
          onLoadCompleteRef.current?.();
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          onErrorRef.current?.(error);
          throw error;
        }
      },
      addSplatScenes: async (sceneOptions: Record<string, unknown>[], showLoadingUI = true) => {
        const viewer = viewerRef.current;
        if (!viewer) throw new Error('Viewer not initialized');

        onLoadStartRef.current?.();

        try {
          const options = sceneOptions.map((opt) => ({
            ...opt,
            showLoadingUI: false,
            progressiveLoad: (opt.progressiveLoad as boolean | undefined) ?? true,
          }));

          await viewer.addSplatScenes(
            options as unknown as GaussianSplats3D.SceneOptions[],
            showLoadingUI,
            (percent: number, percentLabel: string, loaderStatus: number) => {
              onProgressRef.current?.(percent, percentLabel, loaderStatus);
            }
          );

          if (!isRunningRef.current) {
            viewer.start();
            isRunningRef.current = true;
          }

          runIntroAnimation(viewer);
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
        const viewer = viewerRef.current as unknown as ViewerInternalLike;
        if (viewer?.splatMesh) {
          viewer.splatMesh.setPointCloudModeEnabled(enabled);
        }
      },
      setSplatScale: (scale: number) => {
        const viewer = viewerRef.current as unknown as ViewerInternalLike;
        if (viewer?.splatMesh) {
          viewer.splatMesh.setSplatScale(scale);
        }
      },
      setActiveSphericalHarmonicsDegrees: (degree: number) => {
        viewerRef.current?.setActiveSphericalHarmonicsDegrees(degree);
      },
      getSplatScene: (index: number) => {
        const viewer = viewerRef.current as unknown as ViewerInternalLike;
        return viewer?.splatMesh?.scenes?.[index] || null;
      },
      getSceneCount: () => {
        const viewer = viewerRef.current as unknown as ViewerInternalLike;
        return viewer?.splatMesh?.scenes?.length || 0;
      },
      resetCamera: () => {
        if (introRafRef.current !== null) {
          cancelAnimationFrame(introRafRef.current);
          introRafRef.current = null;
        }
        const v = viewerRef.current as unknown as ViewerInternalLike;
        if (!v || !v.controls || !v.camera) return;
        v.controls.target.set(0, 0, 0);
        v.camera.position.set(
          CAMERA.INITIAL_POSITION[0],
          CAMERA.INITIAL_POSITION[1],
          CAMERA.INITIAL_POSITION[2]
        );
        v.camera.lookAt(0, 0, 0);
        v.camera.up.set(CAMERA.UP[0], CAMERA.UP[1], CAMERA.UP[2]);
        v.controls.minDistance = CAMERA.MIN_DISTANCE;
        v.controls.maxDistance = CAMERA.MAX_DISTANCE;
        v.controls.update();
        v.forceRenderNextFrame?.();
      },
      setOrthographicMode: (enabled: boolean) => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
        if (!v) return;
        v.setOrthographicMode?.(enabled);
        v.forceRenderNextFrame?.();
      },
      getOrthographicMode: () => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
        return v?.camera?.isOrthographicCamera ?? false;
      },
      setFov: (fov: number) => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
        const cam = v?.perspectiveCamera;
        if (!cam) return;
        cam.fov = THREE.MathUtils.clamp(fov, 10, 120);
        cam.updateProjectionMatrix();
        v.forceRenderNextFrame?.();
      },
      getFov: () => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
        return v?.perspectiveCamera?.fov ?? 50;
      },
      setBackgroundColor: (color: string) => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
        if (v?.renderer) {
          v.renderer.setClearColor(new THREE.Color(color), 1);
          v.forceRenderNextFrame?.();
        }
      },
      setGridVisible: (visible: boolean) => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
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
        const v = viewerRef.current as unknown as ViewerInternalLike;
        if (!v?.threeScene) return;
        if (!axesHelperRef.current) {
          axesHelperRef.current = new THREE.AxesHelper(1);
          v.threeScene.add(axesHelperRef.current);
        }
        axesHelperRef.current.visible = visible;
        v.forceRenderNextFrame?.();
      },
      setCameraView: (view: CameraView) => {
        const v = viewerRef.current as unknown as ViewerInternalLike;
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
      setEditorViewVisible: (visible: boolean) => {
        editorOverlayRef.current?.setVisible(visible);
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
