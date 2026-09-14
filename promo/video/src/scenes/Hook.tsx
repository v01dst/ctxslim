import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { Field, Reveal, FadeOut, Rule } from "../ui";
import { Grain, Vignette, kenBurns } from "../texture";

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();

  const cam = kenBurns(frame, 240, 1.0, 1.09, 0, 0, 0, -18);

  // headline breathes in word-groups
  const w = (delay: number) =>
    interpolate(frame, [delay, delay + 34], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });

  return (
    <Field>
      <AbsoluteFill style={{ transform: cam, transformOrigin: "center" }}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", gap: 26 }}>
              {["Your", "MCP", "servers"].map((word, i) => (
                <span
                  key={word}
                  style={{
                    fontSize: 150,
                    fontWeight: 700,
                    letterSpacing: -4,
                    opacity: w(8 + i * 14),
                    transform: `translateY(${(1 - w(8 + i * 14)) * 30}px)`,
                  }}
                >
                  {word}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 26, alignItems: "baseline" }}>
              {["are", "eating", "your", "context."].map((word, i) => (
                <span
                  key={word}
                  style={{
                    fontSize: 150,
                    fontWeight: 700,
                    letterSpacing: -4,
                    opacity: w(56 + i * 14),
                    transform: `translateY(${(1 - w(56 + i * 14)) * 30}px)`,
                    color: word === "eating" ? theme.green : theme.ink,
                  }}
                >
                  {word}
                </span>
              ))}
            </div>

            <Reveal from={140}>
              <div style={{ marginTop: 70, textAlign: "center" }}>
                <Rule width={54} delay={146} />
                <div
                  style={{
                    fontSize: 42,
                    fontWeight: 400,
                    color: theme.gray,
                    maxWidth: 1200,
                    lineHeight: 1.5,
                  }}
                >
                  Thousands of tokens are spent before you ask a single question.
                </div>
              </div>
            </Reveal>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>

      <Grain opacity={0.05} />
      <Vignette />
      <FadeOut from={205}>
        <AbsoluteFill />
      </FadeOut>
    </Field>
  );
};
