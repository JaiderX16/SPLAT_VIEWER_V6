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
      className="absolute top-4 left-4 bottom-4 w-[320px] z-[300] flex flex-col rounded-[48px] bg-[#111113]/95 backdrop-blur-[28px] border border-white/[0.06] shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between p-6 pb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm tracking-wider uppercase">
              Splat Viewer
            </h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-white/40 text-xs font-mono">{time}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
          title="Cerrar panel"
          aria-label="Cerrar panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scene Library */}
      <div className="flex-1 overflow-y-auto px-6 py-2">
        <div className="mb-4">
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/30">
            Scene Library
          </span>
        </div>
        <div className="space-y-2">
          {models.map((model, index) => {
            const isActive = activeId === model.url;
            const num = String(index + 1).padStart(2, '0');
            return (
              <button
                key={model.name}
                onClick={() => onSelectModel(model.name)}
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
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="p-6 pt-2">
        <button
          onClick={onUpload}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-full bg-white/5 border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/10 hover:border-white/15 transition-all duration-150"
        >
          <Upload className="w-4 h-4" />
          <span className="text-xs font-semibold tracking-wider uppercase">
            Load Scene
          </span>
        </button>
      </div>
    </aside>
  );
}
