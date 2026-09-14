import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { Field, Reveal, FadeOut, Rule } from "../ui";
import { Grain, Vignette, kenBurns } from "../texture";

const STATEMENTS = [
  {
    n: "01",
    title: "Ranks tools per task.",
    body: "Only what the moment needs reaches the model. Everything else stays one call away.",
  },
  {
    n: "02",
    title: "Compresses every schema.",
    body: "Deterministic, lossless where it matters — no behavior change, fewer tokens.",
  },
  {
    n: "03",
    title: "100% local. Zero keys.",
    body: "A proxy on your machine. Nothing leaves, nothing signs in, nothing to configure.",
  },
];

export const Principles: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = kenBurns(frame, 360, 1.02, 1.0, 0, -20, 0, 10);

  return (
    <Field>
      <AbsoluteFill style={{ transform: cam, transformOrigin: "center" }}>
        <AbsoluteFill style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              marginTop: "auto",
              marginBottom: "auto",
              maxWidth: 1240,
              display: "flex",
              flexDirection: "column",
              gap: 120,
            }}
          >
            {STATEMENTS.map((s, i) => {
              const start = 16 + i * 100;
              const slide = interpolate(frame, [start, start + 40], [-90, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: (t) => 1 - Math.pow(1 - t, 3),
              });
              const ghostOpacity = interpolate(frame, [start, start + 50], [0, 0.05], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div key={i} style={{ position: "relative" }}>
                  {/* giant ghost index */}
                  <div
                    style={{
                      position: "absolute",
                      left: -170,
                      top: -80,
                      fontSize: 300,
                      fontWeight: 800,
                      color: theme.ink,
                      opacity: ghostOpacity,
                      fontFamily: "'Inter', sans-serif",
                      letterSpacing: -14,
                    }}
                  >
                    {s.n}
                  </div>
                  <Reveal from={start} duration={40} rise={30}>
                    <div style={{ transform: `translateX(${slide * 0.3}px)` }}>
                      <Rule width={54} delay={start + 8} />
                      <div
                        style={{
                          fontSize: 96,
                          fontWeight: 650,
                          letterSpacing: -2.5,
                        }}
                      >
                        {s.title}
                      </div>
                      <div
                        style={{
                          marginTop: 26,
                          fontSize: 40,
                          fontWeight: 400,
                          color: theme.gray,
                          lineHeight: 1.45,
                          maxWidth: 1040,
                        }}
                      >
                        {s.body}
                      </div>
                    </div>
                  </Reveal>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>

      <Grain opacity={0.05} />
      <Vignette />
      <FadeOut from={318}>
        <AbsoluteFill />
      </FadeOut>
    </Field>
  );
};
