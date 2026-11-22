import type { ReactNode } from 'react';

const R = 20.5; // 44px box, 3px ring: (44 - 3) / 2
const C = 2 * Math.PI * R;

interface ProgressRingProps {
  /** Filled share of the ring, 0–1. */
  value: number;
  /** Centered in the circle: a short number or a 16px icon. */
  children: ReactNode;
  /** Accessible name and tooltip; without it the ring is decorative. */
  label?: string;
  /** Arc color: a signal pair (light 700–800, dark 300). */
  arcClassName?: string;
  /** Spins the arc, for progress whose end is unknown. */
  spinning?: boolean;
}

/** 44px circle with a 3px ring that fills to `value` and a label in the middle. */
export default function ProgressRing({
  value,
  children,
  label,
  arcClassName = 'stroke-sky-700 dark:stroke-sky-300',
  spinning = false,
}: ProgressRingProps) {
  const share = Math.min(1, Math.max(0, value));
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className="relative size-11 shrink-0 rounded-full bg-black/[0.04] dark:bg-black/[0.20]"
    >
      <svg
        viewBox="0 0 44 44"
        aria-hidden
        className={`absolute inset-0 -rotate-90 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`}
      >
        <circle cx="22" cy="22" r={R} fill="none" strokeWidth="3" className="stroke-black/[0.10] dark:stroke-white/[0.20]" />
        {share > 0 && (
          <circle
            cx="22"
            cy="22"
            r={R}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - share)}
            className={`${arcClassName} transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none`}
          />
        )}
      </svg>
      <span aria-hidden className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-semibold tabular-nums">
        {children}
      </span>
    </div>
  );
}
