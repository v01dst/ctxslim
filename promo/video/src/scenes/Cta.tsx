import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { Field, Reveal } from "../ui";
import { Mascot } from "../Mascot";
import { Grain, Vignette, kenBurns } from "../texture";

const LINES = [
  { prompt: "$", cmd: "npx -y ctxslim", at: 70, ok: "" },
  { prompt: "✓", cmd: "6 servers discovered · 72 tools indexed", at: 150, ok: "dim" },
  { prompt: "✓", cmd: "context: 33.4k → 9.2k tokens", at: 210, ok: "green" },
];

export const Cta: React.FC = () => {
  const frame = useCurrentFrame();

  const endFade = interpolate(frame, [310, 356], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cam = kenBurns(frame, 360, 1.02, 1.0, 0, 0, 10, 0);

  const mascotPeek = interpolate(frame, [250, 300], [180, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  return (
    <Field>
      <AbsoluteFill style={{ transform: cam, transformOrigin: "center" }}>
        <AbsoluteFill style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              marginTop: "auto",
              marginBottom: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Reveal from={10}>
              <div style={{ fontSize: 60, fontWeight: 650, textAlign: "center", letterSpacing: -1.5 }}>
                Try it in one line.
              </div>
            </Reveal>

            <Reveal from={40} duration={30}>
              <div
                style={{
                  marginTop: 64,
                  background: theme.panel,
                  border: `1px solid ${theme.faint}`,
                  borderRadius: 20,
                  padding: "44px 70px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 40,
                  minWidth: 1150,
                  boxShadow: "0 24px 90px rgba(13,13,13,0.08)",
                }}
              >
                {LINES.map((line, i) => {
                  const chars = Math.round(
                    interpolate(frame, [line.at, line.at + line.cmd.length * 0.9], [0, line.cmd.length], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })
                  );
                  const visible = chars > 0;
                  return (
                    <div
                      key={i}
                      style={{
                        marginBottom: i < LINES.length - 1 ? 22 : 0,
                        whiteSpace: "nowrap",
                        opacity: visible ? 1 : 0.25,
                      }}
                    >
                      <span style={{ color: i === 0 ? theme.gray : theme.green, marginRight: 18 }}>
                        {line.prompt}
                      </span>
                      <span
                        style={{
                          color:
                            line.ok === "green"
                              ? theme.greenDeep
                              : line.ok === "dim"
                                ? theme.gray
                                : theme.ink,
                        }}
                      >
                        {line.cmd.slice(0, chars)}
                      </span>
                      {i === 0 && chars < line.cmd.length && (
                        <span style={{ opacity: frame % 24 < 12 ? 1 : 0, color: theme.green }}>▌</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Reveal>

            <Reveal from={230} duration={30}>
              <div style={{ marginTop: 64, fontSize: 34, color: theme.gray }}>
                github.com/v01dst/ctxslim
              </div>
            </Reveal>
          </div>
        </AbsoluteFill>

        {/* mascot peeks from bottom-right, winking */}
        <div
          style={{
            position: "absolute",
            right: 90,
            bottom: 0,
            transform: `translateY(${mascotPeek}px)`,
          }}
        >
          <Mascot size={300} light wink={frame > 265 ? 1 : 0} />
        </div>

        {/* end card */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: theme.bg,
            opacity: endFade,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ marginBottom: 36, transform: `scale(${0.7 + endFade * 0.3})` }}>
            <Mascot size={280} light wink={endFade > 0.7 ? 1 : 0} />
          </div>
          <span style={{ fontSize: 58, fontWeight: 700, letterSpacing: -1.5 }}>CtxSlim</span>
          <div
            style={{
              marginTop: 16,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 28,
              color: theme.gray,
            }}
          >
            put your MCP servers on a diet
          </div>
        </div>
      </AbsoluteFill>

      <Grain opacity={0.05} />
      <Vignette />
    </Field>
  );
};
