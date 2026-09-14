import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { Field, Reveal, FadeOut } from "../ui";
import { ChipField } from "../Chips";
import { Grain, Vignette, kenBurns } from "../texture";

const TRACK = 900;
const BAR_H = 60;

export const Numbers: React.FC = () => {
  const frame = useCurrentFrame();

  const beforeW = TRACK * interpolate(frame, [50, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const afterW = TRACK * 0.276 * interpolate(frame, [115, 170], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  const pct = interpolate(frame, [180, 220], [0, 72.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const pctPunch = interpolate(frame, [180, 200], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 4),
  });

  const shine = interpolate(frame, [175, 235], [-200, 1150], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cam = kenBurns(frame, 300, 1.03, 1.0, 12, -12, 0, 0);

  return (
    <Field>
      <AbsoluteFill style={{ transform: cam, transformOrigin: "center" }}>
        <ChipField from={10} opacityFrom={14} />

        <AbsoluteFill style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              marginTop: "auto",
              marginBottom: "auto",
              width: TRACK + 240,
              background: "rgba(255,255,255,0.92)",
              borderRadius: 48,
              padding: "80px 100px",
              boxShadow: "0 24px 90px rgba(13,13,13,0.10)",
            }}
          >
            <Reveal from={8}>
              <div style={{ fontSize: 72, fontWeight: 650, marginBottom: 90, letterSpacing: -2 }}>
                Measured, not marketed.
              </div>
            </Reveal>

            <Reveal from={40} duration={30}>
              <div style={{ fontSize: 26, color: theme.gray, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                BEFORE
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
                <div style={{ width: TRACK, height: BAR_H, borderRadius: 8, background: theme.faint, overflow: "hidden" }}>
                  <div style={{ width: beforeW, height: "100%", background: theme.ink }} />
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, whiteSpace: "nowrap" }}>
                  33.4k tok
                </span>
              </div>
            </Reveal>

            <div style={{ height: 64 }} />

            <Reveal from={100} duration={30}>
              <div style={{ fontSize: 26, color: theme.gray, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                AFTER CTXSLIM
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
                <div style={{ width: TRACK, height: BAR_H, borderRadius: 8, background: theme.faint, overflow: "hidden", position: "relative" }}>
                  <div style={{ width: afterW, height: "100%", background: theme.green }} />
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: shine,
                      width: 140,
                      height: "100%",
                      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 32,
                    whiteSpace: "nowrap",
                    color: theme.greenDeep,
                  }}
                >
                  9.2k tok
                </span>
              </div>
            </Reveal>

            <Reveal from={178} duration={34}>
              <div style={{ marginTop: 100, textAlign: "center" }}>
                <span style={{ fontSize: 170, fontWeight: 750, letterSpacing: -5, display: "inline-block", transform: `scale(${pctPunch})` }}>
                  {pct.toFixed(1)}
                </span>
                <span style={{ fontSize: 170, fontWeight: 750, letterSpacing: -3, color: theme.green }}>
                  %
                </span>
                <div style={{ marginTop: 18, fontSize: 40, color: theme.gray }}>
                  smaller context, same tools.
                </div>
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
