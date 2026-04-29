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
      <div className="absolute top-4 right-20 z-40 bg-black/80 backdrop-blur-md border border-white/10 rounded-3xl p-5 text-white/50 text-sm min-w-[280px]">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-white/70">Scene Info</span>
          <Button onClick={onToggle} variant="ghost" size="icon" className="h-6 w-6 text-white/50 hover:text-white">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p>No scene loaded</p>
      </div>
    );
  }

  const splatRenderPct = info.splatCount > 0 ? (info.splatRenderCount / info.splatCount * 100).toFixed(1) : '0.0';

  return (
    <div className="absolute top-4 right-20 z-40 bg-black/80 backdrop-blur-md border border-white/10 rounded-3xl p-5 text-white/80 text-sm min-w-[280px] shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-white flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-blue-400" />
          Scene Info
        </span>
        <Button onClick={onToggle} variant="ghost" size="icon" className="h-6 w-6 text-white/50 hover:text-white">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2.5">
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
