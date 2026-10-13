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
          ${dragOver ? 'border-sky-600 dark:border-sky-200 bg-black/[0.05] dark:bg-black/[0.20] scale-[1.02]' : 'border-black/[0.10] dark:border-white/[0.18] bg-black/[0.04] dark:bg-black/[0.20] hover:border-black/[0.16] dark:hover:border-white/[0.28] hover:bg-black/[0.06] dark:hover:bg-black/[0.14]'}
        `}
      >
        <input
          type="file"
          accept=".ply,.splat,.ksplat,.spz"
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <FileUp className="w-10 h-10 mx-auto mb-3 text-neutral-600 dark:text-white/85" />
        <p className="text-neutral-700 dark:text-white font-medium mb-1">Drop a .ply, .splat, .ksplat, or .spz file here</p>
        <p className="text-[#5a5a5f] dark:text-white/85 text-sm">or click to browse</p>
      </div>

      {/* URL Input */}
      <form onSubmit={handleURLSubmit} className="space-y-3">
        <div className="flex items-center gap-2 text-neutral-600 dark:text-white/85">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium">Load from URL</span>
        </div>
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://example.com/scene.splat"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white placeholder:text-[#5a5a5f] dark:placeholder:text-white/70"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !url.trim()} className="rounded-full bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-black/85 dark:hover:bg-white/90">
            <Link className="w-4 h-4 mr-1" />
            Load
          </Button>
        </div>
      </form>

      {/* Options */}
      <div className="bg-black/[0.04] dark:bg-black/[0.20] rounded-xl p-5 space-y-4 border border-black/[0.06] dark:border-white/[0.14]">
        <h3 className="text-neutral-700 dark:text-white font-semibold text-sm uppercase tracking-wider">Load Options</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="progressive" className="text-neutral-600 dark:text-white/85 text-sm">Progressive Load</Label>
            <Switch
              id="progressive"
              checked={options.progressiveLoad}
              onCheckedChange={(v) => updateOption('progressiveLoad', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="alpha" className="text-neutral-600 dark:text-white/85 text-sm">Alpha Threshold</Label>
            <Input
              id="alpha"
              type="number"
              min={0}
              max={255}
              value={options.splatAlphaRemovalThreshold}
              onChange={(e) => updateOption('splatAlphaRemovalThreshold', parseInt(e.target.value) || 0)}
              className="w-20 bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white text-right"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="format" className="text-neutral-600 dark:text-white/85 text-sm">Format</Label>
            <Select value={options.format} onValueChange={(v) => updateOption('format', v as LoadOptions['format'])}>
              <SelectTrigger className="w-32 bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#e8e8ec]/[0.86] dark:bg-[#1e1e20]/[0.78] border-black/[0.10] dark:border-white/[0.18]">
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
            <Label className="text-[#5a5a5f] dark:text-white/85 text-xs">Position X,Y,Z</Label>
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
                  className="w-full bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white text-xs"
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[#5a5a5f] dark:text-white/85 text-xs">Scale X,Y,Z</Label>
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
                  className="w-full bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white text-xs"
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[#5a5a5f] dark:text-white/85 text-xs">Rotation (Quat)</Label>
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
                  className="w-full bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white text-xs"
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
