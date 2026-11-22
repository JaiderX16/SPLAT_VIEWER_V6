import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, FileUp, Globe } from 'lucide-react';
import { DEFAULT_ALPHA_THRESHOLD } from '@/lib/viewerHandle';

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

/** Every upload loads with these; the viewer works out the format from the file name or URL (resolveFormat). */
const defaultOptions: LoadOptions = {
  splatAlphaRemovalThreshold: DEFAULT_ALPHA_THRESHOLD,
  progressiveLoad: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  format: 'auto',
};

const SceneUploader: React.FC<SceneUploaderProps> = ({ onLoadFile, onLoadURL, isLoading }) => {
  const [url, setUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file, defaultOptions);
  }, [onLoadFile]);

  const handleURLSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onLoadURL(url.trim(), defaultOptions);
  }, [url, onLoadURL]);

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
    if (file) onLoadFile(file, defaultOptions);
  }, [onLoadFile]);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300 cursor-pointer
          ${dragOver ? 'border-sky-700 dark:border-sky-200 bg-black/[0.05] dark:bg-black/[0.20] scale-[1.02]' : 'border-black/[0.10] dark:border-white/[0.18] bg-black/[0.04] dark:bg-black/[0.20] hover:border-black/[0.16] dark:hover:border-white/[0.28] hover:bg-black/[0.06] dark:hover:bg-black/[0.14]'}
        `}
      >
        <input
          type="file"
          accept=".ply,.splat,.ksplat,.spz"
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <FileUp className="w-10 h-10 mx-auto mb-3 text-neutral-800 dark:text-white/85" />
        <p className="text-neutral-800 dark:text-white font-medium mb-1">Suelta aquí un archivo .ply, .splat, .ksplat o .spz</p>
        <p className="text-[#46464b] dark:text-white/85 text-sm">o pulsa para elegirlo</p>
      </div>

      {/* URL Input */}
      <form onSubmit={handleURLSubmit} className="space-y-3">
        <div className="flex items-center gap-2 text-neutral-800 dark:text-white/85">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium">Cargar desde URL</span>
        </div>
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://example.com/scene.splat"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 h-12 rounded-full px-5 bg-black/[0.04] dark:bg-black/[0.20] border-black/[0.10] dark:border-white/[0.18] text-neutral-900 dark:text-white placeholder:text-[#46464b] dark:placeholder:text-white/70"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !url.trim()} className="h-12 rounded-full px-5 has-[>svg]:px-5 bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-black/85 dark:hover:bg-white/90">
            <Link className="w-4 h-4 mr-1" />
            Cargar
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SceneUploader;
