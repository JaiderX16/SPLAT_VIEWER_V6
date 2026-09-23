import { useEffect, useState, type RefObject } from 'react';
import { Box, Grid3x3, Compass, Sun, Moon, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  type GaussianSplatViewerHandle,
  type CameraView,
} from '@/components/GaussianSplatViewer';

const VIEW_PRESETS: Array<{ view: CameraView; label: string; title: string }> = [
  { view: 'front', label: 'Frente', title: 'Vista frontal' },
  { view: 'back', label: 'Atrás', title: 'Vista trasera' },
  { view: 'left', label: 'Izq', title: 'Vista izquierda' },
  { view: 'right', label: 'Der', title: 'Vista derecha' },
  { view: 'top', label: 'Arriba', title: 'Vista superior' },
  { view: 'bottom', label: 'Abajo', title: 'Vista inferior' },
  { view: 'reset', label: 'Reset', title: 'Restablecer cámara' },
];

const SH_DEGREES = [0, 1, 2, 3];

interface AdvancedControlsPanelProps {
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

  // Sync initial state from the viewer once it is available.
  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    setOrtho(viewer.getOrthographicMode());
    setFov(Math.round(viewer.getFov()));
  }, [visible, viewerRef]);

  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setOrthographicMode(ortho);
  }, [ortho, visible, viewerRef]);

  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setFov(fov);
  }, [fov, visible, viewerRef]);

  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setActiveSphericalHarmonicsDegrees(shDegree);
  }, [shDegree, visible, viewerRef]);

  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setBackgroundColor(lightBg ? '#e8e8ec' : '#000000');
  }, [lightBg, visible, viewerRef]);

  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setGridVisible(grid);
  }, [grid, visible, viewerRef]);

  useEffect(() => {
    if (!visible) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setAxesVisible(axes);
  }, [axes, visible, viewerRef]);

  if (!visible) return null;

  const applyView = (view: CameraView) => viewerRef.current?.setCameraView(view);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] max-w-[96vw]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/10 px-4 py-3 text-white shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        {/* View presets */}
        <div className="flex items-center gap-1">
          {VIEW_PRESETS.map((preset) => (
            <button
              key={preset.view}
              title={preset.title}
              onClick={() => applyView(preset.view)}
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
          onClick={() => setOrtho((v) => !v)}
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
            onValueChange={(v) => setFov(v[0])}
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
              onClick={() => setShDegree(deg)}
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
          onClick={() => setLightBg((v) => !v)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          {lightBg ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          Fondo
        </button>

        {/* Grid */}
        <button
          title="Mostrar rejilla"
          onClick={() => setGrid((v) => !v)}
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
          onClick={() => setAxes((v) => !v)}
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
