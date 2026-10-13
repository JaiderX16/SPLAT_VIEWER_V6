import { X, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type LoadOptions } from '@/components/SceneUploader';

export interface SceneModelItem {
  name: string;
  url: string;
  format?: LoadOptions['format'];
}

export interface SidebarProps {
  models?: SceneModelItem[];
  activeId?: string;
  onSelectModel: (name: string) => void;
  onUpload: () => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  backend?: 'webgpu' | 'webgl' | 'detecting';
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

export default function Sidebar({
  models = [],
  activeId,
  onSelectModel,
  onUpload,
  isOpen,
  setIsOpen,
  backend = 'detecting',
}: SidebarProps) {
  const [time, setTime] = useState(() => formatTime(new Date()));

  useEffect(() => {
    const timer = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isOpen) return null;

  return (
    <aside
      aria-label="Panel lateral de escenas"
      // Concentric radii: aside 32px − 12px padding → 20px cards → full pills inside.
      className="absolute top-4 left-4 bottom-4 w-[320px] z-[300] flex flex-col gap-2 p-3 rounded-[32px] glass overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between rounded-[20px] bg-white/[0.03] p-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-sky-300 to-fuchsia-300" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm tracking-wider uppercase">
              Splat Viewer
            </h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-white/40 text-xs font-mono">{time}</span>
              {backend !== 'detecting' && (
                <span
                  className="ml-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55"
                  title={backend === 'webgpu' ? 'Renderizado con WebGPU (vgpu)' : 'Renderizado con WebGL (fallback)'}
                >
                  {backend === 'webgpu' ? 'WebGPU' : 'WebGL'}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="pill-btn"
          title="Cerrar panel"
          aria-label="Cerrar panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scene Library */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-3 px-3">
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/30">
            Biblioteca de escenas
          </span>
        </div>
        <div className="space-y-1">
          {models.map((model, index) => {
            const isActive = activeId === model.url;
            const num = String(index + 1).padStart(2, '0');
            return (
              <button
                key={model.name}
                onClick={() => onSelectModel(model.name)}
                className={`
                  w-full flex items-center gap-3 p-2 pr-4 rounded-[20px] transition-colors duration-150 text-left
                  ${isActive
                    ? 'bg-white/[0.08] border border-white/[0.08]'
                    : 'hover:bg-white/[0.04] border border-transparent'
                  }
                `}
              >
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums
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
          })}
        </div>
      </div>

      {/* Footer */}
      <div>
        <button
          onClick={onUpload}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-full bg-white text-black/85 hover:bg-white/90 active:scale-[0.98] transition-all duration-150"
        >
          <Upload className="w-4 h-4" />
          <span className="text-xs font-semibold tracking-wider uppercase">
            Cargar escena
          </span>
        </button>
      </div>
    </aside>
  );
}
