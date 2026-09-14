import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { Field, Reveal, FadeOut } from "../ui";
import { ChipField } from "../Chips";
import { Grain, Vignette, kenBurns } from "../texture";

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();

  const count = Math.round(
    interpolate(frame, [70, 150], [0, 33400], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 3),
    })
  );
  const done = frame >= 150;

  // card slides up from below with a soft landing
  const cardY = interpolate(frame, [8, 55], [140, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const cam = kenBurns(frame, 300, 1.04, 1.0, 0, 0, -14, 0);

  return (
    <Field>
      <AbsoluteFill style={{ transform: cam, transformOrigin: "center" }}>
        <ChipField from={14} />

        <AbsoluteFill
          style={{ alignItems: "center", justifyContent: "center", display: "flex" }}
        >
          <div
            style={{
              textAlign: "center",
              background: "rgba(255,255,255,0.92)",
              borderRadius: 48,
              padding: "84px 110px",
              transform: `translateY(${cardY}px)`,
              boxShadow: "0 24px 90px rgba(13,13,13,0.10)",
            }}
          >
            <Reveal from={20}>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 36,
                  color: theme.gray,
                  marginBottom: 64,
                }}
              >
                6 servers · 12 tools · every schema
              </div>
            </Reveal>

            <Reveal from={40}>
              <div style={{ fontSize: 96, fontWeight: 650, lineHeight: 1.18, letterSpacing: -2.5 }}>
                Injected before the
              </div>
              <div style={{ fontSize: 96, fontWeight: 650, lineHeight: 1.18, letterSpacing: -2.5 }}>
                conversation begins.
              </div>
            </Reveal>

            <Reveal from={70} duration={30}>
              <div
                style={{
                  marginTop: 90,
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "center",
                  gap: 34,
                }}
              >
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 168,
                    fontWeight: 400,
                    fontVariantNumeric: "tabular-nums",
                    color: done ? theme.green : theme.ink,
                  }}
                >
                  {count.toLocaleString("en-US")}
                </span>
                <span style={{ fontSize: 48, color: theme.gray }}>
                  tokens, every session
                </span>
              </div>
            </Reveal>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>

      <Grain opacity={0.05} />
      <Vignette />
      <FadeOut from={258}>
        <AbsoluteFill />
      </FadeOut>
    </Field>
  );
};
