import React, { useMemo } from "react";
import { AbsoluteFill, random, staticFile, useCurrentFrame } from "remotion";
import { theme } from "./theme";

// Inlined brand icon paths (simple-icons, CC0). Fetched once, embedded for
// render-safety — no runtime fetch, no <Img> delayRender flakiness.
const ICON_PATHS: Record<string, string> = {};

export const loadIcon = async (name: string): Promise<void> => {
  if (ICON_PATHS[name]) return;
  const res = await fetch(staticFile(`icons/${name}.svg`));
  const text = await res.text();
  const match = text.match(/ d="([^"]+)"/);
  if (match) ICON_PATHS[name] = match[1];
};

export const Icon: React.FC<{
  name: string;
  size?: number;
  color?: string;
}> = ({ name, size = 28, color = theme.gray }) => {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d={d} fill={color} />
    </svg>
  );
};

export const prefetchIcons = (): void => {
  const names = [
    "github",
    "nodedotjs",
    "react",
    "postgresql",
    "playwright",
    "googlechrome",
    "typescript",
    "linux",
    "docker",
  ];
  names.forEach((n) => loadIcon(n));
};

/** Deterministic floating chip constellation with per-chip parallax drift. */
export const ChipField: React.FC<{
  from: number;
  opacityFrom?: number;
}> = ({ from, opacityFrom = 40 }) => {
  const frame = useCurrentFrame();

  const chips = useMemo(() => {
    const names = [
      "github",
      "nodedotjs",
      "react",
      "postgresql",
      "playwright",
      "googlechrome",
      "typescript",
      "linux",
      "docker",
    ];
    return names.map((name, i) => {
      const seed = `chip-${name}`;
      return {
        name,
        x: 6 + random(`${seed}-x`) * 88,
        y: 8 + random(`${seed}-y`) * 80,
        scale: 0.75 + random(`${seed}-s`) * 0.7,
        driftAmp: 8 + random(`${seed}-a`) * 16,
        driftSpeed: 0.4 + random(`${seed}-sp`) * 0.5,
        phase: random(`${seed}-ph`) * Math.PI * 2,
        appear: from + i * 7,
      };
    });
  }, [from]);

  const fieldOpacity = Math.min(
    1,
    Math.max(0, (frame - opacityFrom) / 30)
  );

  return (
    <AbsoluteFill style={{ opacity: fieldOpacity * 0.5 }}>
      {chips.map((c) => {
        const appearP = Math.min(1, Math.max(0, (frame - c.appear) / 24));
        const ease = 1 - Math.pow(1 - appearP, 3);
        const driftX = Math.sin(frame / (30 / c.driftSpeed) + c.phase) * c.driftAmp;
        const driftY = Math.cos(frame / (34 / c.driftSpeed) + c.phase * 1.3) * c.driftAmp * 0.7;
        return (
          <div
            key={c.name}
            style={{
              position: "absolute",
              left: `${c.x}%`,
              top: `${c.y}%`,
              opacity: ease,
              transform: `translate(${driftX}px, ${driftY}px) scale(${c.scale * (0.8 + ease * 0.2)})`,
              background: theme.panel,
              border: `1px solid ${theme.faint}`,
              borderRadius: 18,
              padding: "18px 22px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              boxShadow: "0 2px 12px rgba(13,13,13,0.04)",
            }}
          >
            <Icon name={c.name} size={30} color={theme.ink} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
