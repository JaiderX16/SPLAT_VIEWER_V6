import { useEffect, useState, useCallback, type ReactNode, type RefObject } from 'react';
import { ArrowDownToLine, Box, Grid3x3, Compass, EyeOff, Sparkles, Sun, Moon, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { SPLAT_BUDGETS, type CameraView, type LodQuality, type SplatViewerHandle } from '@/lib/viewerHandle';
import { formatCompactNumber } from '@/lib/performanceBenchmark';

const LOD_OPTIONS: Array<{ value: LodQuality; label: string; title: string }> = [
  { value: 'high', label: 'Alta', title: 'Sin LOD: todos los splats a calidad completa' },
  { value: 'balanced', label: 'Media', title: 'LOD equilibrado: fusiona en un splat lo lejano que mide menos de 1 px' },
  { value: 'performance', label: 'Rápida', title: 'LOD agresivo: fusiona hasta 2 px, máximo rendimiento en escenas grandes' },
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
  /** Only the controls, for the mobile sheet (which brings its own title and back button). */
  embedded?: boolean;
}

/** The viewer's current settings, as the panel shows them (null: this viewer cannot do it). */
function readViewer(viewer: SplatViewerHandle | null) {
  return {
    ortho: viewer?.getOrthographicMode() ?? false,
    fov: viewer ? Math.round(viewer.getFov()) : 50,
    supportsSH: viewer?.supportsSphericalHarmonics ?? true,
    supportsLod: viewer?.supportsLod ?? false,
    lod: viewer?.getLodQuality() ?? ('balanced' as LodQuality),
    supportsHide: !!viewer?.setHideUnseen,
    hideUnseen: viewer ? (viewer.getHideUnseen?.() ?? false) : true,
    budget: viewer?.getSplatBudget?.() ?? null,
    hideNoise: viewer?.getHideNoise?.() ?? null,
    cutUnderground: viewer?.getCutUnderground?.() ?? null,
  };
}

export default function AdvancedControlsPanel({
  viewerRef,
  visible,
  onClose,
  sceneLight,
  onToggleSceneBackground,
  embedded = false,
}: AdvancedControlsPanelProps) {
  // Read at mount, not only in the effect below: the first layout is already the real one, so the phone sheet
  // (which sizes itself to the panel as it opens) does not measure a panel still missing half its sections.
  const [initial] = useState(() => readViewer(viewerRef.current));
  const [ortho, setOrtho] = useState(initial.ortho);
  const [fov, setFov] = useState(initial.fov);
  const [shDegree, setShDegree] = useState(0);
  const [grid, setGrid] = useState(false);
  const [axes, setAxes] = useState(false);
  const [supportsSH, setSupportsSH] = useState(initial.supportsSH);
  const [supportsLod, setSupportsLod] = useState(initial.supportsLod);
  const [lod, setLod] = useState<LodQuality>(initial.lod);
  const [hideUnseen, setHideUnseen] = useState(initial.hideUnseen);
  const [supportsHide, setSupportsHide] = useState(initial.supportsHide);
  const [budget, setBudget] = useState<number | null>(initial.budget);
  const [hideNoise, setHideNoise] = useState<boolean | null>(initial.hideNoise);
  const [cutUnderground, setCutUnderground] = useState<boolean | null>(initial.cutUnderground);

  // Sync state from viewer when panel becomes visible
  useEffect(() => {
    if (!visible || !viewerRef.current) return;
    const s = readViewer(viewerRef.current);
    setOrtho(s.ortho);
    setFov(s.fov);
    setSupportsSH(s.supportsSH);
    setSupportsLod(s.supportsLod);
    setLod(s.lod);
    setSupportsHide(s.supportsHide);
    setHideUnseen(s.hideUnseen);
    setBudget(s.budget);
    setHideNoise(s.hideNoise);
    setCutUnderground(s.cutUnderground);
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

  // Phone sheet: every control fills its cell of a labeled section. Desktop bar: one row of pills.
  const pill = embedded ? 'pill w-full justify-center' : 'pill';
  const toggle = embedded ? 'pill w-full justify-start' : 'pill';

  const presets = VIEW_PRESETS.map((preset) => (
    <button key={preset.view} title={preset.title} onClick={() => handleApplyView(preset.view)} className={pill}>
      {preset.label}
    </button>
  ));

  const orthoButton = (
    <button title="Ortográfica / Perspectiva" onClick={handleToggleOrtho} className="pill" aria-pressed={ortho}>
      <Box className="w-3.5 h-3.5" />
      Orto
    </button>
  );

  const fovControl = (
    <div className="flex items-center gap-2 px-2">
      <span className="text-[11px] font-mono text-[#46464b] dark:text-white/85">FOV</span>
      <Slider
        value={[fov]}
        onValueChange={handleFovChange}
        min={10}
        max={120}
        step={1}
        className={embedded ? 'flex-1' : 'w-28'}
      />
      <span className="text-[11px] font-mono text-neutral-800 dark:text-white/85 w-8 text-right">{fov}°</span>
    </div>
  );

  // SH quality (the WebGPU .splat path has no SH data)
  const shButtons = SH_DEGREES.map((deg) => (
    <button
      key={deg}
      onClick={() => handleShSelect(deg)}
      className={embedded ? `${pill} font-mono` : 'pill !w-8 !px-0 font-mono'}
      aria-pressed={shDegree === deg}
    >
      {deg}
    </button>
  ));

  const lodButtons = LOD_OPTIONS.map((option) => (
    <button
      key={option.value}
      title={option.title}
      aria-pressed={lod === option.value}
      onClick={() => {
        setLod(option.value);
        viewerRef.current?.setLodQuality(option.value);
      }}
      className={pill}
    >
      {option.label}
    </button>
  ));

  const budgetButtons = SPLAT_BUDGETS.map((value) => (
    <button
      key={value}
      title={value ? `Dibuja como mucho ${value.toLocaleString()} splats: aligera primero los más pequeños` : 'Sin límite de splats'}
      aria-pressed={budget === value}
      onClick={() => {
        setBudget(value);
        viewerRef.current?.setSplatBudget?.(value);
      }}
      className={pill}
    >
      {value ? formatCompactNumber(value) : 'Todos'}
    </button>
  ));

  // Hide what the camera does not see (null: this renderer cannot)
  const hideUnseenButton = supportsHide ? (
    <button
      title="Ocultar lo que la cámara no ve: lo que queda fuera de la pantalla y lo tapado por paredes y objetos (solo se dibuja la primera capa)"
      aria-pressed={hideUnseen}
      onClick={() => {
        const next = !hideUnseen;
        setHideUnseen(next);
        viewerRef.current?.setHideUnseen?.(next);
      }}
      className={toggle}
    >
      <EyeOff className="w-3.5 h-3.5" />
      Ocultar no visibles
    </button>
  ) : null;

  // Hide capture noise: giant blobs and long needles
  const hideNoiseButton = hideNoise !== null ? (
    <button
      title="Ocultar los splats gigantes y las agujas largas: ruido del escaneo que llena la pantalla de manchas y vetas"
      aria-pressed={hideNoise}
      onClick={() => {
        const next = !hideNoise;
        setHideNoise(next);
        viewerRef.current?.setHideNoise?.(next);
      }}
      className={toggle}
    >
      <Sparkles className="w-3.5 h-3.5" />
      Sin splats grandes
    </button>
  ) : null;

  // Cut what lies under the floor: scan noise, never drawn from any angle
  const cutButton = cutUnderground !== null ? (
    <button
      title="Quitar lo que hay bajo el suelo de la escena (ruido del escaneo): no se dibuja desde ningún ángulo. Donde el suelo es semitransparente la imagen cambia algo"
      aria-pressed={cutUnderground}
      onClick={() => {
        const next = !cutUnderground;
        setCutUnderground(next);
        viewerRef.current?.setCutUnderground?.(next);
      }}
      className={toggle}
    >
      <ArrowDownToLine className="w-3.5 h-3.5" />
      Recortar bajo el suelo
    </button>
  ) : null;

  const sceneButtons = (
    <>
      <button title="Fondo claro / oscuro" onClick={onToggleSceneBackground} aria-pressed={sceneLight} className={pill}>
        {sceneLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
        Fondo
      </button>
      <button title="Mostrar rejilla" onClick={handleToggleGrid} className={pill} aria-pressed={grid}>
        <Grid3x3 className="w-3.5 h-3.5" />
        Rejilla
      </button>
      <button title="Mostrar ejes" onClick={handleToggleAxes} className={pill} aria-pressed={axes}>
        <Compass className="w-3.5 h-3.5" />
        Ejes
      </button>
    </>
  );

  if (embedded) {
    // A titled section; its controls sit in an inset well (pad 6 + 32px pill r16 = 22).
    const section = (title: string, columns: string, children: ReactNode, label = title) => (
      <section>
        <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#46464b] dark:text-white/85">{title}</h3>
        <div role="group" aria-label={label} className={`grid ${columns} gap-1 rounded-[22px] bg-black/[0.04] p-1.5 dark:bg-black/[0.20]`}>
          {children}
        </div>
      </section>
    );
    return (
      <div role="region" aria-label="Controles avanzados de cámara y escena" className="space-y-4 text-neutral-900 dark:text-white">
        {section('Vista', 'grid-cols-4', presets)}
        {section('Cámara', 'grid-cols-[auto_1fr] items-center', <>{orthoButton}{fovControl}</>)}
        {supportsSH && section('Armónicos esféricos', 'grid-cols-4', shButtons)}
        {supportsLod && section('Calidad a distancia', 'grid-cols-3', lodButtons, 'Calidad a distancia (LOD)')}
        {budget !== null && section('Máximo de splats', 'grid-cols-4', budgetButtons, 'Máximo de splats dibujados')}
        {(hideUnseenButton || hideNoiseButton || cutButton) && section('Splats', 'grid-cols-1', <>{hideUnseenButton}{hideNoiseButton}{cutButton}</>)}
        {section('Escena', 'grid-cols-3', sceneButtons)}
      </div>
    );
  }

  const divider = <div className="w-px h-5 bg-black/[0.06] dark:bg-black/[0.20]" />;
  const inlineLabel = 'text-[11px] text-[#46464b] dark:text-white/85 mx-1';
  return (
    <div
      role="region"
      aria-label="Controles avanzados de cámara y escena"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] w-max max-w-[calc(100vw-2rem)]"
    >
      {/* Concentric: 22px radius − 6px padding = 16px → h-8 pills are exactly round. */}
      <div className="glass relative isolate flex flex-wrap items-center justify-center gap-x-1 gap-y-1 rounded-[22px] p-1.5 text-neutral-900 dark:text-white">
        <div className="flex flex-wrap items-center justify-center gap-1">{presets}</div>
        {divider}
        {orthoButton}
        {fovControl}
        {divider}
        {supportsSH && (
          <>
            <div className="flex items-center gap-1">
              <span className={inlineLabel}>SH</span>
              {shButtons}
            </div>
            {divider}
          </>
        )}
        {supportsLod && (
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Calidad a distancia (LOD)">
              <span className={inlineLabel}>LOD</span>
              {lodButtons}
            </div>
            {divider}
          </>
        )}
        {budget !== null && (
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Máximo de splats dibujados">
              <span className={inlineLabel}>Máx.</span>
              {budgetButtons}
            </div>
            {divider}
          </>
        )}
        {hideUnseenButton && <>{hideUnseenButton}{divider}</>}
        {hideNoiseButton && <>{hideNoiseButton}{divider}</>}
        {cutButton && <>{cutButton}{divider}</>}
        {sceneButtons}
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
