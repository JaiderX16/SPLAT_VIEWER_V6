import React from 'react';
import { X, Camera, Target, ArrowUp, Zap, Clock, Layers, Grid3X3, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface SceneInfo {
  splatCount: number;
  splatRenderCount: number;
  fps: number | null;
  cameraPosition: string;
  cameraLookAt: string;
  cameraUp: string;
  sortTime: number;
  splatScale: number;
  pointCloudMode: boolean;
  backend?: 'webgpu' | 'webgl';
  lodCulled?: number;
}

interface InfoPanelProps {
  info: SceneInfo | null;
  visible: boolean;
  onToggle: () => void;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ info, visible, onToggle }) => {
  if (!visible) return null;

  if (!info) {
    return (
      <div className="absolute top-4 right-[5.5rem] md:top-6 md:right-[6.5rem] z-40 glass panel text-white/50 text-sm min-w-[280px]">
        <div className="flex items-center justify-between mb-2 pl-2">
          <span className="font-semibold text-white/70">Escena</span>
          <Button onClick={onToggle} variant="ghost" size="icon" className="h-8 w-8 rounded-full text-white/50 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="pl-2 pb-1">No hay escena cargada</p>
      </div>
    );
  }

  const splatRenderPct = info.splatCount > 0 ? (info.splatRenderCount / info.splatCount * 100).toFixed(1) : '0.0';

  return (
    <div className="absolute top-4 right-[5.5rem] md:top-6 md:right-[6.5rem] z-40 glass panel text-white/80 text-sm min-w-[280px]">
      <div className="flex items-center justify-between mb-2 pl-2">
        <span className="font-semibold text-white flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-sky-300" />
          Escena
          {info.backend && (
            <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
              {info.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}
            </span>
          )}
        </span>
        <Button onClick={onToggle} variant="ghost" size="icon" className="h-8 w-8 rounded-full text-white/50 hover:text-white hover:bg-white/10">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="panel-inner bg-white/[0.03] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" /> Position
          </span>
          <span className="font-mono text-xs">{info.cameraPosition}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" /> Look At
          </span>
          <span className="font-mono text-xs">{info.cameraLookAt}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <ArrowUp className="w-3.5 h-3.5" /> Up
          </span>
          <span className="font-mono text-xs">{info.cameraUp}</span>
        </div>

        <div className="border-t border-white/10 my-2" />

        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> FPS
          </span>
          <span className="font-mono text-xs">{info.fps ?? 'N/A'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Splats
          </span>
          <span className="font-mono text-xs">{info.splatCount.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5" /> Rendered
          </span>
          <span className="font-mono text-xs">{info.splatRenderCount.toLocaleString()} ({splatRenderPct}%)</span>
        </div>
        {info.lodCulled !== undefined && info.lodCulled > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-white/50 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> LOD (omitidos)
            </span>
            <span className="font-mono text-xs">{info.lodCulled.toLocaleString()}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-white/50 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Sort Time
          </span>
          <span className="font-mono text-xs">{info.sortTime.toFixed(2)} ms</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50">Splat Scale</span>
          <span className="font-mono text-xs">{info.splatScale.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50">Point Cloud Mode</span>
          <span className="font-mono text-xs">{info.pointCloudMode ? 'On' : 'Off'}</span>
        </div>
      </div>
    </div>
  );
};

export default InfoPanel;
