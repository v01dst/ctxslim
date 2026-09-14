import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "./theme";

export const Field: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        color: theme.ink,
        overflow: "hidden",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** OpenAI-style slow fade + slight rise. */
export const Reveal: React.FC<{
  children: React.ReactNode;
  from: number;
  duration?: number;
  rise?: number;
}> = ({ children, from, duration = 26, rise = 14 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * rise}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Slow fade out at end of scene. */
export const FadeOut: React.FC<{
  children: React.ReactNode;
  from: number;
  duration?: number;
}> = ({ children, from, duration = 24 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [from, from + duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{ opacity: p, width: "100%" }}>{children}</div>;
};

/** Thin green editorial rule. */
export const Rule: React.FC<{ width?: number; delay?: number }> = ({
  width = 64,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  return (
    <div
      style={{
        width: width * p,
        height: 3,
        background: theme.green,
        marginBottom: 42,
      }}
    />
  );
};
