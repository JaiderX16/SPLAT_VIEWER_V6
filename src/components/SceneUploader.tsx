import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, FileUp, Globe } from 'lucide-react';

export interface SceneUploaderProps {
  onLoadFile: (file: File, options: LoadOptions) => void;
  onLoadURL: (url: string, options: LoadOptions) => void;
  isLoading: boolean;
}

export interface LoadOptions {
  splatAlphaRemovalThreshold: number;
  progressiveLoad: boolean;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  format: 'auto' | 'ply' | 'splat' | 'ksplat' | 'spz';
}

const defaultOptions: LoadOptions = {
  splatAlphaRemovalThreshold: 1,
  progressiveLoad: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  format: 'auto',
};

export const SceneUploader: React.FC<SceneUploaderProps> = ({ onLoadFile, onLoadURL, isLoading }) => {
  const [url, setUrl] = useState('');
  const [options, setOptions] = useState<LoadOptions>(defaultOptions);
  const [dragOver, setDragOver] = useState(false);

  const detectFormatFromFileName = useCallback((fileName: string): LoadOptions['format'] => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'ply') return 'ply';
    if (ext === 'splat') return 'splat';
    if (ext === 'ksplat') return 'ksplat';
    if (ext === 'spz') return 'spz';
    return 'auto';
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const detectedFormat = detectFormatFromFileName(file.name);
      const finalOptions = options.format === 'auto' ? { ...options, format: detectedFormat } : options;
      onLoadFile(file, finalOptions);
    }
  }, [onLoadFile, options, detectFormatFromFileName]);

  const handleURLSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      const detectedFormat = detectFormatFromFileName(url.trim());
      const finalOptions = options.format === 'auto' ? { ...options, format: detectedFormat } : options;
      onLoadURL(url.trim(), finalOptions);
    }
  }, [url, onLoadURL, options, detectFormatFromFileName]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const detectedFormat = detectFormatFromFileName(file.name);
      const finalOptions = options.format === 'auto' ? { ...options, format: detectedFormat } : options;
      onLoadFile(file, finalOptions);
    }
  }, [onLoadFile, options, detectFormatFromFileName]);

  const updateOption = useCallback(<K extends keyof LoadOptions>(key: K, value: LoadOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300 cursor-pointer
          ${dragOver ? 'border-blue-400 bg-blue-500/10 scale-[1.02]' : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10'}
        `}
      >
        <input
          type="file"
          accept=".ply,.splat,.ksplat,.spz"
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <FileUp className="w-10 h-10 mx-auto mb-3 text-white/60" />
        <p className="text-white/80 font-medium mb-1">Drop a .ply, .splat, .ksplat, or .spz file here</p>
        <p className="text-white/40 text-sm">or click to browse</p>
      </div>

      {/* URL Input */}
      <form onSubmit={handleURLSubmit} className="space-y-3">
        <div className="flex items-center gap-2 text-white/70">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium">Load from URL</span>
        </div>
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://example.com/scene.splat"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 bg-white/5 border-white/20 text-white placeholder:text-white/30"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !url.trim()} className="bg-blue-600 hover:bg-blue-700">
            <Link className="w-4 h-4 mr-1" />
            Load
          </Button>
        </div>
      </form>

      {/* Options */}
      <div className="bg-white/5 rounded-xl p-5 space-y-4 border border-white/10">
        <h3 className="text-white/80 font-semibold text-sm uppercase tracking-wider">Load Options</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="progressive" className="text-white/60 text-sm">Progressive Load</Label>
            <Switch
              id="progressive"
              checked={options.progressiveLoad}
              onCheckedChange={(v) => updateOption('progressiveLoad', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="alpha" className="text-white/60 text-sm">Alpha Threshold</Label>
            <Input
              id="alpha"
              type="number"
              min={0}
              max={255}
              value={options.splatAlphaRemovalThreshold}
              onChange={(e) => updateOption('splatAlphaRemovalThreshold', parseInt(e.target.value) || 0)}
              className="w-20 bg-white/5 border-white/20 text-white text-right"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="format" className="text-white/60 text-sm">Format</Label>
            <Select value={options.format} onValueChange={(v) => updateOption('format', v as LoadOptions['format'])}>
              <SelectTrigger className="w-32 bg-white/5 border-white/20 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-white/20">
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="ply">.ply</SelectItem>
                <SelectItem value="splat">.splat</SelectItem>
                <SelectItem value="ksplat">.ksplat</SelectItem>
                <SelectItem value="spz">.spz</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2">
          <div>
            <Label className="text-white/40 text-xs">Position X,Y,Z</Label>
            <div className="flex gap-1 mt-1">
              {[0, 1, 2].map((i) => (
                <Input
                  key={`pos-${i}`}
                  type="number"
                  step={0.1}
                  value={options.position[i]}
                  onChange={(e) => {
                    const newPos = [...options.position] as [number, number, number];
                    newPos[i] = parseFloat(e.target.value) || 0;
                    updateOption('position', newPos);
                  }}
                  className="w-full bg-white/5 border-white/20 text-white text-xs"
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-white/40 text-xs">Scale X,Y,Z</Label>
            <div className="flex gap-1 mt-1">
              {[0, 1, 2].map((i) => (
                <Input
                  key={`scale-${i}`}
                  type="number"
                  step={0.1}
                  value={options.scale[i]}
                  onChange={(e) => {
                    const newScale = [...options.scale] as [number, number, number];
                    newScale[i] = parseFloat(e.target.value) || 0;
                    updateOption('scale', newScale);
                  }}
                  className="w-full bg-white/5 border-white/20 text-white text-xs"
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-white/40 text-xs">Rotation (Quat)</Label>
            <div className="flex gap-1 mt-1">
              {[0, 1, 2, 3].map((i) => (
                <Input
                  key={`rot-${i}`}
                  type="number"
                  step={0.1}
                  value={options.rotation[i]}
                  onChange={(e) => {
                    const newRot = [...options.rotation] as [number, number, number, number];
                    newRot[i] = parseFloat(e.target.value) || 0;
                    updateOption('rotation', newRot);
                  }}
                  className="w-full bg-white/5 border-white/20 text-white text-xs"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneUploader;
