import { createContext, useContext, useEffect, type ReactNode, type RefObject } from 'react';
import { LiquidGlassSurface, setLiquidGlassLiveSource, useLiquidGlassCapture } from '@memoria-labs/liquid-glass';

interface LiquidGlassState {
  domCanvas: HTMLCanvasElement | null;
  pageRef: RefObject<HTMLElement | null>;
}

const LiquidGlassContext = createContext<LiquidGlassState | null>(null);

interface ProviderProps {
  /** Off (no HUD): no page capture, no live source. */
  enabled: boolean;
  pageRef: RefObject<HTMLElement | null>;
  canvas: HTMLCanvasElement | null;
  children: ReactNode;
}

/**
 * Liquid glass (@memoria-labs/liquid-glass) for the HUD: the glass refracts the live 3D scene.
 * `canvas` is the WebGPU scene canvas; until it exists the glass refracts a photo of the page.
 */
export function LiquidGlassProvider({ enabled, ...props }: ProviderProps) {
  return enabled ? <ActiveLiquidGlass {...props} /> : props.children;
}

function ActiveLiquidGlass({ pageRef, canvas, children }: Omit<ProviderProps, 'enabled'>) {
  const { domCanvas } = useLiquidGlassCapture(pageRef);

  useEffect(() => {
    if (!canvas) return;
    setLiquidGlassLiveSource(canvas);
    return () => {
      setLiquidGlassLiveSource(null);
    };
  }, [canvas]);

  return <LiquidGlassContext.Provider value={{ domCanvas, pageRef }}>{children}</LiquidGlassContext.Provider>;
}

/**
 * Liquid-glass background for a floating HUD piece (first layer over the scene). Goes as the first
 * child of a positioned container with its own stacking context (`isolate`); `radius` is the
 * container's corner radius in px. Outside a provider (embedded viewers) it renders nothing and
 * the container's frosted `.glass` shows instead.
 */
export function GlassBackdrop({ radius }: { radius: number }) {
  const glass = useContext(LiquidGlassContext);
  if (!glass?.domCanvas) return null;
  return <LiquidGlassSurface domCanvas={glass.domCanvas} pageRef={glass.pageRef} radius={radius} />;
}
