import { useEffect, useState, useCallback, type RefObject } from 'react';
import { Box, Grid3x3, Compass, Sun, Moon, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import type { CameraView, LodQuality, SplatViewerHandle } from '@/lib/viewerHandle';

const LOD_OPTIONS: Array<{ value: LodQuality; label: string; title: string }> = [
  { value: 'high', label: 'Alta', title: 'Sin LOD: todos los splats a calidad completa' },
  { value: 'balanced', label: 'Media', title: 'LOD equilibrado: aligera los splats lejanos (< 1.25 px)' },
  { value: 'performance', label: 'Rápida', title: 'LOD agresivo: máximo rendimiento en escenas grandes' },
];

const VIEW_PRESETS: Array<{ view: CameraView; label: string; title: string }> = [
  { view: 'front', label: 'Frente', title: 'Vista frontal (1)' },
  { view: 'back', label: 'Atrás', title: 'Vista trasera (2)' },
  { view: 'left', label: 'Izq', title: 'Vista izquierda (3)' },
  { view: 'right', label: 'Der', title: 'Vista derecha (4)' },
  { view: 'top', label: 'Arriba', title: 'Vista superior (5)' },
  { view: 'bottom', label: 'Abajo', title: 'Vista inferior (6)' },
  { view: 'reset', label: 'Reset', title: 'Restablecer cámara (0)' },
];

const SH_DEGREES = [0, 1, 2, 3];

export interface AdvancedControlsPanelProps {
  viewerRef: RefObject<SplatViewerHandle | null>;
  visible: boolean;
  onClose: () => void;
  /** True when the 3D scene background is light. */
  sceneLight: boolean;
  onToggleSceneBackground: () => void;
}

export default function AdvancedControlsPanel({
  viewerRef,
  visible,
  onClose,
  sceneLight,
  onToggleSceneBackground,
}: AdvancedControlsPanelProps) {
  const [ortho, setOrtho] = useState(false);
  const [fov, setFov] = useState(50);
  const [shDegree, setShDegree] = useState(0);
  const [grid, setGrid] = useState(false);
  const [axes, setAxes] = useState(false);
  const [supportsSH, setSupportsSH] = useState(true);
  const [supportsLod, setSupportsLod] = useState(false);
  const [lod, setLod] = useState<LodQuality>('balanced');

  // Sync state from viewer when panel becomes visible
  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    setOrtho(viewer.getOrthographicMode());
    setFov(Math.round(viewer.getFov()));
    setSupportsSH(viewer.supportsSphericalHarmonics);
    setSupportsLod(viewer.supportsLod);
    setLod(viewer.getLodQuality());
  }, [visible, viewerRef]);

  const handleApplyView = useCallback((view: CameraView) => {
    viewerRef.current?.setCameraView(view);
  }, [viewerRef]);

  const handleToggleOrtho = useCallback(() => {
    const next = !ortho;
    setOrtho(next);
    viewerRef.current?.setOrthographicMode(next);
  }, [ortho, viewerRef]);

  const handleFovChange = useCallback((value: number[]) => {
    const nextFov = value[0];
    setFov(nextFov);
    viewerRef.current?.setFov(nextFov);
  }, [viewerRef]);

  const handleShSelect = useCallback((degree: number) => {
    setShDegree(degree);
    viewerRef.current?.setActiveSphericalHarmonicsDegrees(degree);
  }, [viewerRef]);

  const handleToggleGrid = useCallback(() => {
    const next = !grid;
    setGrid(next);
    viewerRef.current?.setGridVisible(next);
  }, [grid, viewerRef]);

  const handleToggleAxes = useCallback(() => {
    const next = !axes;
    setAxes(next);
    viewerRef.current?.setAxesVisible(next);
  }, [axes, viewerRef]);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Controles avanzados de cámara y escena"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] w-max max-w-[calc(100vw-2rem)]"
    >
      {/* Concentric: 22px radius − 6px padding = 16px → h-8 pills are exactly round. */}
      <div className="glass flex flex-wrap items-center justify-center gap-x-1 gap-y-1 rounded-[22px] p-1.5 text-neutral-900 dark:text-white">
        {/* View presets */}
        <div className="flex items-center gap-1">
          {VIEW_PRESETS.map((preset) => (
            <button
              key={preset.view}
              title={preset.title}
              onClick={() => handleApplyView(preset.view)}
              className="pill"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-black/[0.06] dark:bg-black/[0.20]" />

        {/* Orthographic toggle */}
        <button
          title="Ortográfica / Perspectiva"
          onClick={handleToggleOrtho}
          className="pill"
          aria-pressed={ortho}
        >
          <Box className="w-3.5 h-3.5" />
          Orto
        </button>

        {/* FOV */}
        <div className="flex items-center gap-2 px-2">
          <span className="text-[11px] font-mono text-[#5a5a5f] dark:text-white/85">FOV</span>
          <Slider
            value={[fov]}
            onValueChange={handleFovChange}
            min={10}
            max={120}
            step={1}
            className="w-28"
          />
          <span className="text-[11px] font-mono text-neutral-600 dark:text-white/85 w-8 text-right">{fov}°</span>
        </div>

        <div className="w-px h-5 bg-black/[0.06] dark:bg-black/[0.20]" />

        {/* SH quality (the WebGPU .splat path has no SH data) */}
        {supportsSH && (
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-[#5a5a5f] dark:text-white/85 mr-1">SH</span>
          {SH_DEGREES.map((deg) => (
            <button
              key={deg}
              onClick={() => handleShSelect(deg)}
              className="pill !w-8 !px-0 font-mono"
              aria-pressed={shDegree === deg}
            >
              {deg}
            </button>
          ))}
        </div>
        )}

        {supportsSH && <div className="w-px h-5 bg-black/[0.06] dark:bg-black/[0.20]" />}

        {/* Distance LOD */}
        {supportsLod && (
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Calidad a distancia (LOD)">
              <span className="text-[11px] text-[#5a5a5f] dark:text-white/85 mx-1">LOD</span>
              {LOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  title={option.title}
                  aria-pressed={lod === option.value}
                  onClick={() => {
                    setLod(option.value);
                    viewerRef.current?.setLodQuality(option.value);
                  }}
                  className="pill"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-black/[0.06] dark:bg-black/[0.20]" />
          </>
        )}

        {/* Background */}
        <button
          title="Fondo claro / oscuro"
          onClick={onToggleSceneBackground}
          aria-pressed={sceneLight}
          className="pill"
        >
          {sceneLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          Fondo
        </button>

        {/* Grid */}
        <button
          title="Mostrar rejilla"
          onClick={handleToggleGrid}
          className="pill"
          aria-pressed={grid}
        >
          <Grid3x3 className="w-3.5 h-3.5" />
          Rejilla
        </button>

        {/* Axes */}
        <button
          title="Mostrar ejes"
          onClick={handleToggleAxes}
          className="pill"
          aria-pressed={axes}
        >
          <Compass className="w-3.5 h-3.5" />
          Ejes
        </button>

        {/* Close */}
        <button
          title="Cerrar"
          onClick={onClose}
          className="pill !w-8 !px-0"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
