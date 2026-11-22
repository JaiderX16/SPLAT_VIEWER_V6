import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SplatRenderer } from '@/lib/webgpu-splat/SplatRenderer';
import {
  CAMERA,
  DEFAULT_ALPHA_THRESHOLD,
  INTRO,
  VIEW_DIRECTIONS,
  framingFromPose,
  framingPose,
  isAbortError,
  resolveFormat,
  type CameraFraming,
  type SceneLoadOptions,
  type SplatViewerHandle,
  type SplatViewerProps,
} from '@/lib/viewerHandle';

/** Por canvas: promesa que se cumple cuando su último renderer terminó de crearse (o de descartarse). */
const canvasesOcupados = new WeakMap<HTMLCanvasElement, Promise<void>>();

interface WebGPUSplatViewerProps extends SplatViewerProps {
  /** Called when WebGPU cannot start, so the host can fall back to WebGL. */
  onUnsupported?: (error: Error) => void;
}

/**
 * React shell around `SplatRenderer` (vgpu). Owns the canvas and the
 * renderer's lifetime; everything performance-sensitive lives outside React.
 */
const WebGPUSplatViewer = forwardRef<SplatViewerHandle, WebGPUSplatViewerProps>(
  ({ className = '', onProgress, onLoadStart, onLoadComplete, onError, onUnsupported, background = '#000000', theme = 'dark' }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<SplatRenderer | null>(null);
    const readyRef = useRef<Promise<SplatRenderer> | null>(null);
    const hasSceneRef = useRef(false);
    /** Encuadre de la escena cargada: la entrada y «restablecer cámara» vuelven a él. */
    const framingRef = useRef<CameraFraming | null>(null);
    const callbacks = useRef({ onProgress, onLoadStart, onLoadComplete, onError, onUnsupported });
    // Latest look, read when the renderer finishes initializing.
    const lookRef = useRef({ background, theme });
    // Click-to-navigate feedback rings (CSS only, they never touch the GPU).
    const [markers, setMarkers] = useState<Array<{ id: number; x: number; y: number; kind: 'scene' | 'map' }>>([]);
    const markerIdRef = useRef(0);

    useEffect(() => {
      callbacks.current = { onProgress, onLoadStart, onLoadComplete, onError, onUnsupported };
    }, [onProgress, onLoadStart, onLoadComplete, onError, onUnsupported]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let disposed = false;

      // Un renderer anterior sobre este canvas (React lo monta dos veces en desarrollo, o un remontaje
      // rápido) se descarta al terminar de crearse y desconfigura el contexto WebGPU del canvas: el nuevo
      // espera a que ese termine para no quedarse con un contexto muerto.
      const anterior = canvasesOcupados.get(canvas) ?? Promise.resolve();
      const ready = anterior.then(() => {
        if (disposed) throw new DOMException('unmounted', 'AbortError');
        return SplatRenderer.create(canvas, {
        up: CAMERA.UP,
        limits: {
          minDistance: CAMERA.MIN_DISTANCE,
          maxDistance: CAMERA.MAX_DISTANCE,
          minPolarAngle: CAMERA.MIN_POLAR_ANGLE,
          maxPolarAngle: CAMERA.MAX_POLAR_ANGLE,
        },
        fovDeg: 50,
        background: lookRef.current.background,
        onError: (error) => callbacks.current.onError?.(error),
        onNavigate: ({ x, y, kind }) => {
          const id = ++markerIdRef.current;
          setMarkers((m) => [...m.slice(-3), { id, x, y, kind }]);
          window.setTimeout(() => setMarkers((m) => m.filter((marker) => marker.id !== id)), 700);
        },
      });
      }).then(async (renderer) => {
        if (disposed) {
          renderer.dispose();
          throw new DOMException('unmounted', 'AbortError');
        }
        renderer.controls.setPose(CAMERA.INITIAL_POSITION, CAMERA.LOOK_AT);
        renderer.setBackground(lookRef.current.background);
        renderer.setTheme(lookRef.current.theme);
        await renderer.start();
        rendererRef.current = renderer;
        // Solo en desarrollo: para inspeccionar la cámara desde la consola (encuadres por modelo).
        if (import.meta.env.DEV) (window as unknown as { __splat?: SplatRenderer }).__splat = renderer;
        return renderer;
      });
      ready.catch((error: unknown) => {
        if (isAbortError(error)) return;
        callbacks.current.onUnsupported?.(error instanceof Error ? error : new Error(String(error)));
      });
      canvasesOcupados.set(canvas, ready.then(() => undefined, () => undefined));
      readyRef.current = ready;

      return () => {
        disposed = true;
        readyRef.current = null;
        rendererRef.current?.dispose();
        rendererRef.current = null;
        hasSceneRef.current = false;
      };
    }, []);

    useEffect(() => {
      lookRef.current = { background, theme };
      rendererRef.current?.setBackground(background);
      rendererRef.current?.setTheme(theme);
    }, [background, theme]);

    useImperativeHandle(ref, (): SplatViewerHandle => ({
      backend: 'webgpu',
      supportsSphericalHarmonics: false,
      supportsLod: true,
      setLodQuality: (quality) => rendererRef.current?.setLodQuality(quality),
      setHideUnseen: (enabled) => rendererRef.current?.setHideUnseen(enabled),
      setSplatBudget: (budget) => rendererRef.current?.setSplatBudget(budget),
      setHideNoise: (enabled) => rendererRef.current?.setHideNoise(enabled),
      getHideNoise: () => rendererRef.current?.getHideNoise() ?? false,
      setCutUnderground: (enabled) => rendererRef.current?.setCutUnderground(enabled),
      getCutUnderground: () => rendererRef.current?.getCutUnderground() ?? false,
      getSplatBudget: () => rendererRef.current?.getSplatBudget() ?? 0,
      getHideUnseen: () => rendererRef.current?.getHideUnseen() ?? true,
      getLodQuality: () => rendererRef.current?.getLodQuality() ?? 'balanced',
      addSplatScene: async (path: string, options: SceneLoadOptions = {}) => {
        const ready = readyRef.current;
        if (!ready) throw new Error('El visor aún no está listo');
        const renderer = await ready;
        const format = resolveFormat(options.format, path);
        if (format !== 'splat' && format !== 'auto') {
          throw new Error(`El renderizador WebGPU solo admite .splat (recibido: .${format})`);
        }

        callbacks.current.onLoadStart?.();
        hasSceneRef.current = true;
        framingRef.current = options.framing ?? null;
        const pose = framingPose(framingRef.current);
        try {
          await renderer.load(path, {
            alphaThreshold: options.splatAlphaRemovalThreshold ?? DEFAULT_ALPHA_THRESHOLD,
            transform: { position: options.position, rotation: options.rotation, scale: options.scale },
            onProgress: (percent, label, status) => callbacks.current.onProgress?.(percent, label, status),
            // Start the cinematic entrance as soon as the first splats stream in.
            // Exterior con encuadre: gira y se acerca hasta posarse justo en el encuadre guardado; luego
            // sigue girando despacio desde ahí.
            // Interior con encuadre: sin vuelo ni giro, ya desde donde se quedará la cámara.
            // Sin encuadre: la entrada de siempre, que sigue girando despacio.
            onFirstSplats: () => {
              const f = framingRef.current;
              if (f && !f.eye) {
                renderer.playFramedIntro(pose.position, pose.target, pose.startDistance, INTRO.DURATION_MS, Math.max(0, f.speed ?? INTRO.SPEED_SLOW));
                return;
              }
              renderer.playIntro(
                pose.position,
                pose.target,
                pose.startDistance,
                pose.distance,
                INTRO.DURATION_MS,
                f?.eye ? 0 : INTRO.SPEED_INTRO,
                f?.eye ? 0 : INTRO.SPEED_SLOW,
              );
            },
          });
          callbacks.current.onLoadComplete?.();
        } catch (e) {
          if (isAbortError(e)) return;
          hasSceneRef.current = false;
          const error = e instanceof Error ? e : new Error(String(e));
          callbacks.current.onError?.(error);
          throw error;
        }
      },
      removeSplatScene: async () => {
        rendererRef.current?.clear();
        hasSceneRef.current = false;
      },
      getSceneCount: () => (hasSceneRef.current ? 1 : 0),
      getStats: () => {
        const renderer = rendererRef.current;
        if (!renderer) return null;
        const s = renderer.getStats();
        return {
          backend: 'webgpu',
          splatCount: s.splatCount,
          renderCount: s.visibleCount,
          lodCulled: s.lodCulled,
          offscreenCulled: renderer.getHideUnseen() ? s.offscreen : null,
          occlusionCulled: renderer.getHideUnseen() ? s.occluded : null,
          undergroundCulled: renderer.getCutUnderground() ? s.underground : null,
          noiseCulled: renderer.getHideNoise() ? s.noisy : null,
          gpuMs: s.gpuMs,
          fps: s.fps,
          sortTimeMs: s.sortMs,
          drawCalls: s.drawCalls,
          renderWidth: s.canvasWidth,
          renderHeight: s.canvasHeight,
          renderPixelRatio: Math.round(s.dpr * 10) / 10,
          gpuBufferMB: s.gpuBufferMB,
          cameraPosition: s.cameraPosition,
          cameraTarget: s.cameraTarget,
          cameraUp: s.cameraUp,
          splatScale: renderer.getSplatScale(),
          pointCloudMode: renderer.getPointCloud(),
        };
      },
      setPointCloudMode: (enabled) => rendererRef.current?.setPointCloud(enabled),
      setSplatScale: (scale) => rendererRef.current?.setSplatScale(scale),
      setActiveSphericalHarmonicsDegrees: () => {
        // `.splat` files carry no spherical harmonics.
      },
      resetCamera: () => {
        const controls = rendererRef.current?.controls;
        if (!controls) return;
        const pose = framingPose(framingRef.current);
        const d = [pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]] as [number, number, number];
        controls.cancelFly();
        controls.focus(pose.target);
        controls.lookFrom(d, pose.initialDistance);
      },
      setOrthographicMode: (enabled) => rendererRef.current?.setOrthographic(enabled),
      getOrthographicMode: () => rendererRef.current?.getOrthographic() ?? false,
      setFov: (fov) => rendererRef.current?.setFov(fov),
      getFov: () => rendererRef.current?.getFov() ?? 50,
      setBackgroundColor: (color) => rendererRef.current?.setBackground(color),
      setGridVisible: (visible) => rendererRef.current?.setGridVisible(visible),
      setAxesVisible: (visible) => rendererRef.current?.setAxesVisible(visible),
      setCameraView: (view) => {
        const controls = rendererRef.current?.controls;
        if (!controls) return;
        controls.autoRotate = false;
        controls.cancelFly();
        if (view === 'reset') {
          const pose = framingPose(framingRef.current);
          controls.focus(pose.target);
          controls.lookFrom([pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]], pose.initialDistance);
          return;
        }
        controls.lookFrom(VIEW_DIRECTIONS[view], Math.max(controls.distance, 2.5));
      },
      setEditorViewVisible: (visible) => rendererRef.current?.setEditorViewVisible(visible),
      setNavigation: (settings) => rendererRef.current?.setNavigation(settings),
      getCameraFraming: () => {
        const c = rendererRef.current?.controls;
        return c ? framingFromPose(c.getPosition(), c.getTarget(), c.mode !== 'orbit') : null;
      },
      standAt: (eye, target) => rendererRef.current?.standAt(eye, target),
      setSpinSpeed: (rpm) => rendererRef.current?.setSpinSpeed(rpm),
    }), []);

    return (
      <div className={`relative w-full h-full overflow-hidden ${className}`} style={{ background }}>
        <canvas ref={canvasRef} className="block w-full h-full outline-none" />
        {markers.map((m) => (
          <span
            key={m.id}
            aria-hidden
            className={`nav-ripple ${m.kind === 'map' ? 'nav-ripple--map' : ''}`}
            style={{ left: m.x, top: m.y }}
          />
        ))}
      </div>
    );
  },
);

WebGPUSplatViewer.displayName = 'WebGPUSplatViewer';

export default WebGPUSplatViewer;
