import { Compass, Footprints, Orbit, Plane, ScanEye, Smartphone, X, type LucideIcon } from 'lucide-react';
import type { NavigationMode, NavigationSettings } from '@/lib/viewerHandle';

type Hint = [input: string, action: string];

interface ModeInfo {
  id: NavigationMode;
  name: string;
  description: string;
  icon: LucideIcon;
  recommended?: boolean;
  mouse: Hint[];
  touch: Hint[];
}

/** Same order as NAVIGATION_CYCLE (the `V` shortcut). */
const NAVIGATION_MODES: ModeInfo[] = [
  {
    id: 'walk',
    name: 'Recorrer',
    description: 'Camina por el lugar a la altura de los ojos, siguiendo el suelo.',
    icon: Footprints,
    recommended: true,
    mouse: [
      ['Arrastrar', 'Mirar alrededor'],
      ['W A S D · ↑ ↓', 'Caminar'],
      ['← →', 'Girar'],
      ['Q / E', 'Agacharte / elevarte'],
      ['Shift', 'Correr'],
      ['Rueda', 'Avanzar / retroceder'],
      ['Clic', 'Caminar hasta ahí'],
    ],
    touch: [
      ['1 dedo', 'Mirar alrededor'],
      ['2 dedos', 'Caminar (arriba = avanzar)'],
      ['Pellizcar', 'Avanzar / retroceder'],
      ['Tocar', 'Caminar hasta ahí'],
    ],
  },
  {
    id: 'look',
    name: 'Panorama',
    description: 'Quédate en un punto, mira a tu alrededor y salta de un sitio a otro.',
    icon: ScanEye,
    mouse: [
      ['Arrastrar', 'Mirar alrededor'],
      ['Flechas', 'Girar la vista'],
      ['Rueda', 'Zoom'],
      ['Clic', 'Saltar hasta ahí'],
    ],
    touch: [
      ['1 dedo', 'Mirar alrededor'],
      ['Pellizcar', 'Zoom'],
      ['Tocar', 'Saltar hasta ahí'],
    ],
  },
  {
    id: 'fly',
    name: 'Vuelo libre',
    description: 'Muévete en cualquier dirección, sin gravedad.',
    icon: Plane,
    mouse: [
      ['Arrastrar', 'Mirar'],
      ['W A S D', 'Volar'],
      ['Q / E', 'Bajar / subir'],
      ['Shift', 'Turbo'],
      ['Rueda', 'Avanzar / retroceder'],
      ['Clic', 'Volar hasta ahí'],
    ],
    touch: [
      ['1 dedo', 'Mirar'],
      ['2 dedos', 'Moverte'],
      ['Pellizcar', 'Avanzar / retroceder'],
      ['Tocar', 'Volar hasta ahí'],
    ],
  },
  {
    id: 'orbit',
    name: 'Órbita',
    description: 'Gira alrededor de la escena para verla desde fuera.',
    icon: Orbit,
    mouse: [
      ['Arrastrar', 'Girar alrededor'],
      ['Clic der. / Shift', 'Desplazar'],
      ['Rueda', 'Acercar / alejar'],
      ['Clic', 'Ir a ese punto'],
    ],
    touch: [
      ['1 dedo', 'Girar alrededor'],
      ['2 dedos', 'Desplazar'],
      ['Pellizcar', 'Acercar / alejar'],
      ['Tocar', 'Ir a ese punto'],
    ],
  },
];

const SPEEDS = [
  { label: 'Lenta', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Rápida', value: 2 },
];

const INSET = 'bg-black/[0.04] dark:bg-black/[0.20]';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[#46464b] dark:text-white/85';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 dark:focus-visible:outline-sky-200';

interface NavigationPanelProps {
  settings: NavigationSettings;
  onChange: (patch: Partial<NavigationSettings>) => void;
  onClose: () => void;
}

export default function NavigationPanel({ settings, onChange, onClose }: NavigationPanelProps) {
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mode = NAVIGATION_MODES.find((m) => m.id === settings.mode) ?? NAVIGATION_MODES[0];
  const firstPerson = settings.mode !== 'orbit';
  const canGyro = touch && firstPerson && 'DeviceOrientationEvent' in window;
  const hints: Hint[] = touch ? mode.touch : [...mode.mouse, ['V', 'Cambiar de modo']];

  const toggleGyro = async () => {
    if (!settings.gyro) {
      // iOS only grants motion sensors from a user gesture.
      const permission = (window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
      if (permission && (await permission().catch(() => 'denied')) !== 'granted') return;
    }
    onChange({ gyro: !settings.gyro });
  };

  return (
    <section
      aria-label="Navegación"
      // pad 12 + list row r28 = 40
      className="absolute top-4 right-[5.5rem] md:top-6 md:right-[6.5rem] z-40 glass rounded-[40px] p-3 w-[min(340px,calc(100vw-7rem))] max-h-[calc(100%-2rem)] overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-2 pl-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
          <Compass className="w-4 h-4 text-sky-900 dark:text-sky-100" />
          Navegación
        </span>
        <button
          onClick={onClose}
          className={`size-8 rounded-full inline-flex items-center justify-center text-[#46464b] dark:text-white/85 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-black/[0.14] transition-colors ${FOCUS}`}
          title="Cerrar"
          aria-label="Cerrar navegación"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div role="radiogroup" aria-label="Modo de navegación" className="space-y-1">
        {NAVIGATION_MODES.map((m) => {
          const active = m.id === settings.mode;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ mode: m.id })}
              // pad 8 + 40px circle r20 = 28
              className={`w-full flex items-center gap-3 p-2 pr-3 rounded-[28px] text-left border transition-colors duration-150 ${FOCUS} ${
                active
                  ? 'bg-black/[0.05] dark:bg-black/[0.20] border-black/[0.06] dark:border-white/[0.14]'
                  : 'border-transparent hover:bg-black/[0.04] dark:hover:bg-black/[0.14]'
              }`}
            >
              <span
                className={`size-10 shrink-0 rounded-full flex items-center justify-center ${
                  active ? 'bg-black/[0.08] dark:bg-white/[0.10] text-neutral-900 dark:text-white' : `${INSET} text-[#46464b] dark:text-white/85`
                }`}
              >
                <Icon className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-white">
                  {m.name}
                  {m.recommended && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${INSET} text-neutral-800 dark:text-white/85`}>
                      Inmersivo
                    </span>
                  )}
                </span>
                <span className="block mt-0.5 text-xs leading-snug text-[#46464b] dark:text-white/85">{m.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {(settings.mode === 'walk' || settings.mode === 'fly') && (
        <div className="mt-3 flex items-center justify-between gap-3 pl-2">
          <span className={LABEL}>Velocidad</span>
          {/* pad 6 + 32px pill r16 = 22 */}
          <div role="radiogroup" aria-label="Velocidad" className={`inline-flex gap-1 rounded-[22px] p-1.5 ${INSET}`}>
            {SPEEDS.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={settings.speed === s.value}
                aria-pressed={settings.speed === s.value}
                onClick={() => onChange({ speed: s.value })}
                className="pill"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canGyro && (
        <div className="mt-3 flex items-center justify-between gap-3 pl-2">
          <span className={LABEL}>Giroscopio</span>
          {/* pad 6 + 32px pill r16 = 22 */}
          <div className={`inline-flex rounded-[22px] p-1.5 ${INSET}`}>
            <button aria-pressed={settings.gyro} onClick={() => void toggleGyro()} className="pill">
              <Smartphone className="w-3.5 h-3.5" />
              {settings.gyro ? 'Activado' : 'Activar'}
            </button>
          </div>
        </div>
      )}

      {/* pad 12 (text only) + chip r4 ≈ 16 */}
      <div className={`mt-3 panel-inner p-3 ${INSET}`}>
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#46464b] dark:text-white/85">Controles</span>
        <ul className="mt-2 space-y-1.5">
          {hints.map(([input, action]) => (
            <li key={input} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-mono font-medium text-neutral-900 dark:text-white whitespace-nowrap">{input}</span>
              <span className="text-right text-[#46464b] dark:text-white/85">{action}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
