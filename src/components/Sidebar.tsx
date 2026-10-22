import { X, Upload } from 'lucide-react';
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

export default function Sidebar({
  models = [],
  activeId,
  onSelectModel,
  onUpload,
  isOpen,
  setIsOpen,
}: SidebarProps) {
  if (!isOpen) return null;

  return (
    <aside
      aria-label="Panel lateral de escenas"
      // Concentric radii: pad 18 + 48px upload pill r24 = 42 (the 44px close pill sits ~concentric too);
      // rows: pad 8 + 40px circle r20 = 28.
      className="absolute top-4 left-4 bottom-4 w-[320px] z-[300] flex flex-col gap-2 p-[18px] rounded-[42px] glass overflow-hidden"
    >
      {/* Header */}
      <div className="flex justify-end">
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
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#46464b] dark:text-white/85">
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
                  w-full flex items-center gap-3 p-2 pr-4 rounded-[28px] transition-colors duration-150 text-left
                  ${isActive
                    ? 'bg-black/[0.05] dark:bg-black/[0.20] border border-black/[0.06] dark:border-white/[0.14]'
                    : 'hover:bg-black/[0.04] dark:hover:bg-black/[0.14] border border-transparent'
                  }
                `}
              >
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums
                    ${isActive ? 'bg-black/[0.06] dark:bg-black/[0.20] text-neutral-900 dark:text-white' : 'bg-black/[0.04] dark:bg-black/[0.20] text-[#46464b] dark:text-white/85'}
                  `}
                >
                  {num}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium truncate ${isActive ? 'text-neutral-900 dark:text-white' : 'text-neutral-800 dark:text-white/85'}`}
                  >
                    {model.name}
                  </div>
                  <div className="text-[10px] text-[#46464b] dark:text-white/85 font-medium uppercase tracking-wider mt-0.5">
                    Splat
                  </div>
                </div>
                <div
                  className={`
                    w-1.5 h-1.5 rounded-full
                    ${isActive ? 'bg-neutral-900 dark:bg-white dark:shadow-[0_0_6px_rgba(255,255,255,0.5)]' : 'bg-black/[0.06] dark:bg-black/[0.20]'}
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
          className="w-full flex items-center justify-center gap-2 h-12 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-black/85 dark:hover:bg-white/90 active:scale-[0.98] transition-all duration-150"
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
