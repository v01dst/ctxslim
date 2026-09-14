import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "./theme";

/** Film grain via SVG turbulence — cheap, deterministic enough for video. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.05 }) => {
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Soft vignette to focus the center. */
export const Vignette: React.FC = () => {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <defs>
          <radialGradient id="vig" cx="50%" cy="46%" r="75%">
            <stop offset="62%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.16)" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#vig)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Continuous Ken Burns drift — nothing in this video is ever static. */
export const kenBurns = (
  frame: number,
  duration: number,
  fromScale: number,
  toScale: number,
  fromX = 0,
  toX = 0,
  fromY = 0,
  toY = 0
): string => {
  const p = Math.min(1, Math.max(0, frame / duration));
  const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const s = fromScale + (toScale - fromScale) * e;
  const x = fromX + (toX - fromX) * e;
  const y = fromY + (toY - fromY) * e;
  return `scale(${s}) translate(${x}px, ${y}px)`;
};
