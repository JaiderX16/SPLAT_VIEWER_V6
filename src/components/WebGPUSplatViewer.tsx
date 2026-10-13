import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SplatRenderer } from '@/lib/webgpu-splat/SplatRenderer';
import {
  CAMERA,
  INTRO,
  VIEW_DIRECTIONS,
  isAbortError,
  resolveFormat,
  type SceneLoadOptions,
  type SplatViewerHandle,
  type SplatViewerProps,
} from '@/lib/viewerHandle';

interface WebGPUSplatViewerProps extends SplatViewerProps {
  /** Called when WebGPU cannot start, so the host can fall back to WebGL. */
  onUnsupported?: (error: Error) => void;
}

/**
 * React shell around `SplatRenderer` (vgpu). Owns the canvas and the
 * renderer's lifetime; everything performance-sensitive lives outside React.
 */
const WebGPUSplatViewer = forwardRef<SplatViewerHandle, WebGPUSplatViewerProps>(
  ({ className = '', onProgress, onLoadStart, onLoadComplete, onError, onUnsupported }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<SplatRenderer | null>(null);
    const readyRef = useRef<Promise<SplatRenderer> | null>(null);
    const hasSceneRef = useRef(false);
    const callbacks = useRef({ onProgress, onLoadStart, onLoadComplete, onError, onUnsupported });
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

      const ready = SplatRenderer.create(canvas, {
        up: CAMERA.UP,
        limits: {
          minDistance: CAMERA.MIN_DISTANCE,
          maxDistance: CAMERA.MAX_DISTANCE,
          minPolarAngle: CAMERA.MIN_POLAR_ANGLE,
          maxPolarAngle: CAMERA.MAX_POLAR_ANGLE,
        },
        fovDeg: 50,
        background: '#000000',
        onError: (error) => callbacks.current.onError?.(error),
        onNavigate: ({ x, y, kind }) => {
          const id = ++markerIdRef.current;
          setMarkers((m) => [...m.slice(-3), { id, x, y, kind }]);
          window.setTimeout(() => setMarkers((m) => m.filter((marker) => marker.id !== id)), 700);
        },
      }).then(async (renderer) => {
        if (disposed) {
          renderer.dispose();
          throw new DOMException('unmounted', 'AbortError');
        }
        renderer.controls.setPose(CAMERA.INITIAL_POSITION, CAMERA.LOOK_AT);
        await renderer.start();
        rendererRef.current = renderer;
        return renderer;
      });
      ready.catch((error: unknown) => {
        if (isAbortError(error)) return;
        callbacks.current.onUnsupported?.(error instanceof Error ? error : new Error(String(error)));
      });
      readyRef.current = ready;

      return () => {
        disposed = true;
        readyRef.current = null;
        rendererRef.current?.dispose();
        rendererRef.current = null;
        hasSceneRef.current = false;
      };
    }, []);

    useImperativeHandle(ref, (): SplatViewerHandle => ({
      backend: 'webgpu',
      supportsSphericalHarmonics: false,
      supportsEditorView: true,
      addSplatScene: async (path: string, options: SceneLoadOptions = {}) => {
        const ready = readyRef.current;
        if (!ready) throw new Error('Viewer not initialized');
        const renderer = await ready;
        const format = resolveFormat(options.format, path);
        if (format !== 'splat' && format !== 'auto') {
          throw new Error(`El renderizador WebGPU solo admite .splat (recibido: .${format})`);
        }

        callbacks.current.onLoadStart?.();
        hasSceneRef.current = true;
        try {
          await renderer.load(path, {
            alphaThreshold: options.splatAlphaRemovalThreshold ?? 1,
            transform: { position: options.position, rotation: options.rotation, scale: options.scale },
            onProgress: (percent, label, status) => callbacks.current.onProgress?.(percent, label, status),
            // Start the cinematic entrance as soon as the first splats stream in.
            onFirstSplats: () =>
              renderer.playIntro(
                CAMERA.INITIAL_POSITION,
                CAMERA.LOOK_AT,
                INTRO.START_DISTANCE,
                INTRO.END_DISTANCE,
                INTRO.DURATION_MS,
                INTRO.SPEED_INTRO,
                INTRO.SPEED_SLOW,
              ),
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
        const p = CAMERA.INITIAL_POSITION;
        controls.cancelFly();
        controls.focus(CAMERA.LOOK_AT);
        controls.lookFrom(p, Math.hypot(p[0], p[1], p[2]));
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
          const p = CAMERA.INITIAL_POSITION;
          controls.focus(CAMERA.LOOK_AT);
          controls.lookFrom(p, Math.hypot(p[0], p[1], p[2]));
          return;
        }
        controls.lookFrom(VIEW_DIRECTIONS[view], Math.max(controls.distance, 2.5));
      },
      setEditorViewVisible: (visible) => rendererRef.current?.setEditorViewVisible(visible),
    }), []);

    return (
      <div className={`relative w-full h-full overflow-hidden bg-black ${className}`}>
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
