import { useEffect, useState, useCallback, type RefObject } from 'react';
import { Box, Grid3x3, Compass, Sun, Moon, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  type GaussianSplatViewerHandle,
  type CameraView,
} from '@/components/GaussianSplatViewer';

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
  viewerRef: RefObject<GaussianSplatViewerHandle | null>;
  visible: boolean;
  onClose: () => void;
}

export default function AdvancedControlsPanel({
  viewerRef,
  visible,
  onClose,
}: AdvancedControlsPanelProps) {
  const [ortho, setOrtho] = useState(false);
  const [fov, setFov] = useState(50);
  const [shDegree, setShDegree] = useState(0);
  const [lightBg, setLightBg] = useState(false);
  const [grid, setGrid] = useState(false);
  const [axes, setAxes] = useState(false);

  // Sync state from viewer when panel becomes visible
  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    setOrtho(viewer.getOrthographicMode());
    setFov(Math.round(viewer.getFov()));
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

  const handleToggleBg = useCallback(() => {
    const next = !lightBg;
    setLightBg(next);
    viewerRef.current?.setBackgroundColor(next ? '#e8e8ec' : '#000000');
  }, [lightBg, viewerRef]);

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
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] max-w-[96vw]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-[#0f0f11]/90 backdrop-blur-xl border border-white/10 px-4 py-3 text-white shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
        {/* View presets */}
        <div className="flex items-center gap-1">
          {VIEW_PRESETS.map((preset) => (
            <button
              key={preset.view}
              title={preset.title}
              onClick={() => handleApplyView(preset.view)}
              className="px-2 py-1.5 rounded-md text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-white/10" />

        {/* Orthographic toggle */}
        <button
          title="Ortográfica / Perspectiva"
          onClick={handleToggleOrtho}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
            ortho ? 'text-sky-300 bg-sky-400/10' : 'text-white/70 hover:bg-white/10'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          Orto
        </button>

        {/* FOV */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-white/50">FOV</span>
          <Slider
            value={[fov]}
            onValueChange={handleFovChange}
            min={10}
            max={120}
            step={1}
            className="w-28"
          />
          <span className="text-[11px] font-mono text-white/70 w-8 text-right">{fov}°</span>
        </div>

        <div className="w-px h-6 bg-white/10" />

        {/* SH quality */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-white/50 mr-1">SH</span>
          {SH_DEGREES.map((deg) => (
            <button
              key={deg}
              onClick={() => handleShSelect(deg)}
              className={`w-7 h-7 rounded-md text-[11px] font-mono transition-colors ${
                shDegree === deg
                  ? 'text-white bg-white/15'
                  : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}
            >
              {deg}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-white/10" />

        {/* Background */}
        <button
          title="Fondo claro / oscuro"
          onClick={handleToggleBg}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          {lightBg ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          Fondo
        </button>

        {/* Grid */}
        <button
          title="Mostrar rejilla"
          onClick={handleToggleGrid}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
            grid ? 'text-amber-300 bg-amber-400/10' : 'text-white/70 hover:bg-white/10'
          }`}
        >
          <Grid3x3 className="w-3.5 h-3.5" />
          Rejilla
        </button>

        {/* Axes */}
        <button
          title="Mostrar ejes"
          onClick={handleToggleAxes}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
            axes ? 'text-emerald-300 bg-emerald-400/10' : 'text-white/70 hover:bg-white/10'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          Ejes
        </button>

        {/* Close */}
        <button
          title="Cerrar"
          onClick={onClose}
          className="ml-1 p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
