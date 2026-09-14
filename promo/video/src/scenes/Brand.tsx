import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { Field, Reveal, FadeOut } from "../ui";
import { Mascot } from "../Mascot";
import { Grain, Vignette, kenBurns } from "../texture";

const word = "CTXSLIM";

export const Brand: React.FC = () => {
  const frame = useCurrentFrame();

  const mascotIn = interpolate(frame, [14, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const mascotScale = interpolate(mascotIn, [0, 1], [0.8, 1]);
  const mascotBob = interpolate(frame, [58, 120, 190], [0, -12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // slow zoom-out for the whole scene
  const cam = kenBurns(frame, 240, 1.07, 1.0, 0, 0, 0, 0);

  return (
    <Field>
      <AbsoluteFill style={{ transform: cam, transformOrigin: "center" }}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              transform: `scale(${mascotScale}) translateY(${mascotBob}px)`,
              opacity: mascotIn,
              marginBottom: 56,
            }}
          >
            <Mascot size={380} light />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {word.split("").map((ch, i) => {
              const start = 55 + i * 10;
              const p = interpolate(frame, [start, start + 30], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                // overshoot for life
                easing: (t) => {
                  const c3 = t - 1;
                  return 1 + 0.06 * Math.pow(c3, 3) + 0.18 * c3 * c3;
                },
              });
              return (
                <span
                  key={i}
                  style={{
                    fontSize: 150,
                    fontWeight: 750,
                    letterSpacing: -3,
                    opacity: Math.min(1, p * 1.2),
                    transform: `translateY(${(1 - p) * 26}px) scale(${0.94 + p * 0.06})`,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>

          <Reveal from={135}>
            <div
              style={{
                marginTop: 50,
                fontSize: 42,
                color: theme.gray,
                fontWeight: 400,
              }}
            >
              Put your MCP servers on a diet.
            </div>
          </Reveal>
        </AbsoluteFill>
      </AbsoluteFill>

      <Grain opacity={0.05} />
      <Vignette />
      <FadeOut from={200}>
        <AbsoluteFill />
      </FadeOut>
    </Field>
  );
};
