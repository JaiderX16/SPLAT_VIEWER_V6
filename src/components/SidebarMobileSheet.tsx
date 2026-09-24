import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { Search, ArrowLeft, X, Upload } from 'lucide-react';
import { type SceneModelItem } from './Sidebar';

export type SheetState = 'idle' | 'half' | 'full';

// ============================================================================
// CONSTANTES
// ============================================================================

const IDLE_HEIGHT = 56;
const HALF_RATIO = 0.6;
const FULL_RATIO = 0.9;
const IDLE_MAX_WIDTH = 320;
const HALF_WIDTH_RATIO = 0.94;

// Umbrales de snapping como fracción del rango posible
const SNAP_TO_IDLE_THRESHOLD = 0.25; // < 25% del rango → idle
const SNAP_TO_FULL_THRESHOLD = 0.75; // > 75% del rango → full

// ============================================================================
// HOOKS
// ============================================================================

interface WindowSize {
  w: number;
  h: number;
}

/** Escucha cambios de tamaño de ventana con throttle via RAF */
function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 390,
    h: typeof window !== 'undefined' ? window.innerHeight : 844,
  }));

  useEffect(() => {
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() =>
        setSize({ w: window.innerWidth, h: window.innerHeight })
      );
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return size;
}

interface SnapHeights {
  idle: number;
  half: number;
  full: number;
}

/** Calcula las alturas de snap en función de la altura de pantalla */
function useSnapHeights(screenH: number): SnapHeights {
  return useMemo(
    () => ({
      idle: IDLE_HEIGHT,
      half: Math.round(screenH * HALF_RATIO),
      full: Math.round(screenH * FULL_RATIO),
    }),
    [screenH]
  );
}

// ============================================================================
// HELPERS
// ============================================================================

/** Interpola linealmente entre a y b con factor t ∈ [0,1] */
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

interface SheetGeometry {
  width: number;
  bottom: number;
  radTop: number;
  radBottom: number;
}

/** Calcula geometría del sheet a partir de la altura actual */
function computeSheetGeometry(currentH: number, snapHeights: SnapHeights, screenW: number): SheetGeometry {
  const { idle: idleH, half: halfH, full: fullH } = snapHeights;

  const idleW = Math.min(IDLE_MAX_WIDTH, Math.max(0, screenW - 48));
  const halfW = screenW * HALF_WIDTH_RATIO;
  const fullW = screenW;

  let width: number;
  let radTop: number;
  let radBottom: number;
  let bottom: number;

  if (currentH <= idleH) {
    width = idleW;
    radTop = 48;
    radBottom = 48;
    bottom = 22;
  } else if (currentH <= halfH) {
    const t = (currentH - idleH) / (halfH - idleH);
    width = lerp(idleW, halfW, t);
    radTop = 48;
    radBottom = 48;
    bottom = lerp(22, (screenW - halfW) / 2, t);
  } else {
    const t = (currentH - halfH) / (fullH - halfH);
    width = lerp(halfW, fullW, t);
    radTop = 48;
    radBottom = 48;
    bottom = lerp((screenW - halfW) / 2, 0, t);
  }

  return { width, bottom, radTop, radBottom };
}

/** Determina el estado de snap más cercano dada la altura de arrastre */
function resolveSnapState(currentH: number, snapHeights: SnapHeights): SheetState {
  const { idle: idleH, full: fullH } = snapHeights;
  const range = fullH - idleH;
  const ratio = (currentH - idleH) / range;

  if (ratio < SNAP_TO_IDLE_THRESHOLD) return 'idle';
  if (ratio > SNAP_TO_FULL_THRESHOLD) return 'full';
  return 'half';
}

// ============================================================================
// SUB-COMPONENTES
// ============================================================================

const ClearButton = ({ onClear }: { onClear: (e: React.MouseEvent) => void }) => (
  <button
    type="button"
    aria-label="Limpiar búsqueda"
    onClick={onClear}
    className="p-1 rounded-full hover:bg-white/10 text-white/60 transition-colors"
  >
    <X size={16} />
  </button>
);

interface SearchBarProps {
  isExpanded: boolean;
  placeholder: string;
  onExpand: () => void;
  onCollapse: () => void;
  value: string;
  onChange: (value: string) => void;
}

const SearchBar = ({
  isExpanded,
  placeholder,
  onExpand,
  onCollapse,
  value,
  onChange,
}: SearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContainerClick = useCallback(() => {
    if (!isExpanded) onExpand();
  }, [isExpanded, onExpand]);

  const handleBackClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isExpanded) onCollapse();
    },
    [isExpanded, onCollapse]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('');
      inputRef.current?.focus();
    },
    [onChange]
  );

  return (
    <div
      className={`shrink-0 transition-all duration-700 ${
        isExpanded ? 'px-6' : 'px-0 py-0'
      }`}
    >
      <div
        role={isExpanded ? undefined : 'button'}
        aria-label={isExpanded ? undefined : 'Abrir búsqueda'}
        tabIndex={isExpanded ? undefined : 0}
        onClick={handleContainerClick}
        onKeyDown={(e) => {
          if (!isExpanded && (e.key === 'Enter' || e.key === ' ')) onExpand();
        }}
        className={`flex items-center overflow-hidden transition-all duration-700 ${
          isExpanded ? 'cursor-text' : 'cursor-pointer'
        } ${
          isExpanded
            ? 'bg-white/10 rounded-full px-4 h-14'
            : 'bg-transparent rounded-full px-6 h-14'
        }`}
      >
        {/* Botón icono izquierdo */}
        <button
          type="button"
          aria-label={isExpanded ? 'Cerrar búsqueda' : 'Buscar'}
          className={`transition-all duration-700 flex items-center justify-center shrink-0 ${
            isExpanded ? 'pr-2' : 'pr-3'
          } text-white/60`}
          onClick={handleBackClick}
        >
          {isExpanded ? <ArrowLeft size={20} /> : <Search size={22} />}
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!isExpanded}
          aria-label={placeholder}
          className={`w-full bg-transparent outline-none text-[16px] h-full transition-all duration-700 ${
            !isExpanded ? 'pointer-events-none select-none' : ''
          } ${
            isExpanded
              ? 'text-white placeholder:text-white/40'
              : 'text-white/60 placeholder:text-white/40'
          }`}
        />

        {/* Botón derecho (clear / icono search) */}
        <div
          className={`shrink-0 transition-all duration-700 flex items-center justify-center overflow-hidden ${
            isExpanded ? 'w-6 opacity-100 ml-2' : 'w-0 opacity-0 ml-0'
          }`}
        >
          {value ? (
            <ClearButton onClear={handleClear} />
          ) : (
            <Search size={18} className="text-white/40" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
};

interface DragHandleProps {
  isVisible: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const DragHandle = ({ isVisible, onPointerDown, onPointerMove, onPointerUp }: DragHandleProps) => (
  <div
    role="separator"
    aria-hidden="true"
    className={`w-full flex items-center justify-center cursor-grab active:cursor-grabbing shrink-0 touch-none transition-all duration-300 ${
      isVisible ? 'h-[24px] opacity-100' : 'h-0 opacity-0 pointer-events-none'
    }`}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
  >
    <div className="w-12 h-[5px] bg-white/20 rounded-full pointer-events-none" />
  </div>
);

/** Elemento de modelo individual en la lista */
interface ModelItemProps {
  model: SceneModelItem;
  index: number;
  isActive: boolean;
  onSelect: (name: string) => void;
}

const ModelItem = ({ model, index, isActive, onSelect }: ModelItemProps) => {
  const num = String(index + 1).padStart(2, '0');
  return (
    <button
      onClick={() => onSelect(model.name)}
      className={`
        w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 text-left
        ${isActive
          ? 'bg-white/[0.08] border border-white/[0.08]'
          : 'hover:bg-white/[0.04] border border-transparent'
        }
      `}
    >
      <div
        className={`
          w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold
          ${isActive ? 'bg-white/10 text-white' : 'bg-white/5 text-white/30'}
        `}
      >
        {num}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-white/60'}`}
        >
          {model.name}
        </div>
        <div className="text-[10px] text-white/25 font-medium uppercase tracking-wider mt-0.5">
          Splat
        </div>
      </div>
      <div
        className={`
          w-1.5 h-1.5 rounded-full
          ${isActive ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.5)]' : 'bg-white/10'}
        `}
      />
    </button>
  );
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export interface SidebarMobileSheetProps {
  sheetState: SheetState;
  onSheetStateChange: (state: SheetState) => void;
  models?: SceneModelItem[];
  activeId?: string;
  onSelectModel?: (name: string) => void;
  onUpload?: () => void;
  searchPlaceholder?: string;
  className?: string;
}

const SidebarMobileSheet = ({
  sheetState,
  onSheetStateChange,
  models = [],
  activeId,
  onSelectModel,
  onUpload,
  searchPlaceholder = 'Search scenes…',
  className = '',
}: SidebarMobileSheetProps) => {
  const { w: screenW, h: screenH } = useWindowSize();
  const isMobile = screenW < 768;

  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const isDragging = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const snapHeights = useSnapHeights(screenH);

  // Altura final aplicada al sheet
  const currentH = dragHeight !== null ? dragHeight : snapHeights[sheetState];

  // Sin transición mientras arrastra
  const transitionClass =
    dragHeight !== null
      ? ''
      : 'transition-all duration-500 ease-out';

  // Geometría derivada
  const geometry = useMemo(
    () => computeSheetGeometry(currentH, snapHeights, screenW),
    [currentH, snapHeights, screenW]
  );

  const isExpanded = currentH > IDLE_HEIGHT + 4;

  // ── Filtrado memoizado ──────────────────────────────────────────────────────
  const q = busqueda.trim().toLowerCase();

  const filteredModels = useMemo(
    () =>
      q
        ? models.filter((m) => m.name.toLowerCase().includes(q))
        : models,
    [models, q]
  );

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleExpand = useCallback(
    () => onSheetStateChange('half'),
    [onSheetStateChange]
  );

  const handleCollapse = useCallback(() => {
    onSheetStateChange('idle');
    setBusqueda('');
  }, [onSheetStateChange]);

  const handleModelClick = useCallback(
    (sceneName: string) => {
      onSelectModel?.(sceneName);
      onSheetStateChange('idle');
      setBusqueda('');
    },
    [onSelectModel, onSheetStateChange]
  );

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = snapHeights[sheetState];
    },
    [sheetState, snapHeights]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const deltaY = startYRef.current - e.clientY;
    const newH = startHeightRef.current + deltaY;
    const clamped = Math.max(
      IDLE_HEIGHT,
      Math.min(snapHeights.full + 24, newH)
    );
    setDragHeight(clamped);
  }, [snapHeights.full]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);

      setDragHeight((h) => {
        if (h === null) return null;
        const nextState = resolveSnapState(h, snapHeights);
        onSheetStateChange(nextState);
        if (nextState === 'idle') setBusqueda('');
        return null;
      });
    },
    [snapHeights, onSheetStateChange]
  );

  if (!isMobile) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scene library"
      className={`absolute left-1/2 z-[900] bg-[#111113]/95 backdrop-blur-[28px] border border-white/[0.06] overflow-hidden shadow-[0_-10px_50px_rgba(0,0,0,0.5)] flex flex-col pointer-events-auto ${transitionClass} ${className}`}
      style={{
        bottom: `${geometry.bottom}px`,
        height: `${currentH}px`,
        width: `${geometry.width}px`,
        borderTopLeftRadius: `${geometry.radTop}px`,
        borderTopRightRadius: `${geometry.radTop}px`,
        borderBottomLeftRadius: `${geometry.radBottom}px`,
        borderBottomRightRadius: `${geometry.radBottom}px`,
        willChange: 'height, width, border-radius, transform',
        transform: 'translate(-50%, 0px)',
      }}
    >
      {/* Manija */}
      <DragHandle
        isVisible={isExpanded}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Barra de búsqueda */}
      <SearchBar
        isExpanded={isExpanded}
        placeholder={searchPlaceholder}
        value={busqueda}
        onChange={setBusqueda}
        onExpand={handleExpand}
        onCollapse={handleCollapse}
      />

      {/* Contenido – lista de modelos */}
      <div
        inert={!isExpanded ? true : undefined}
        className={`flex-1 overflow-y-auto mt-2 px-4 transition-[opacity,transform] duration-300 delay-75
          [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
          ${
            isExpanded
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
      >
        {/* Header */}
        <div className="mb-3 px-1">
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/30">
            Scene Library
          </span>
        </div>

        {/* Model list */}
        <div className="space-y-1.5">
          {filteredModels.map((model, index) => (
            <ModelItem
              key={model.name}
              model={model}
              index={index}
              isActive={activeId === model.url}
              onSelect={handleModelClick}
            />
          ))}
          {q && filteredModels.length === 0 && (
            <div className="text-center py-8 text-white/30 text-sm">
              No scenes found
            </div>
          )}
        </div>

        {/* Upload button */}
        <div className="mt-4 mb-4">
          <button
            onClick={() => {
              onUpload?.();
              onSheetStateChange('idle');
            }}
            className="w-full flex items-center justify-center gap-2 h-12 rounded-full bg-white/5 border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/10 hover:border-white/15 transition-all duration-150"
          >
            <Upload className="w-4 h-4" />
            <span className="text-xs font-semibold tracking-wider uppercase">
              Load Scene
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarMobileSheet;
