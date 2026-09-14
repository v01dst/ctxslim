import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { theme, SCENES, TOTAL_FRAMES } from "./theme";
import { Fonts } from "./Fonts";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { Brand } from "./scenes/Brand";
import { Principles } from "./scenes/Principles";
import { Numbers } from "./scenes/Numbers";
import { Cta } from "./scenes/Cta";

/** slow cross-dissolve between scenes, OpenAI-style */
const Cross: React.FC<{ children: React.ReactNode; duration: number }> = ({
  children,
  duration,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 24, duration - 24, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
    </AbsoluteFill>
  );
};

const MUSIC = "bgm3.mp3";

export const CtxSlimPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Fonts />

      <Sequence from={SCENES.hook.from} durationInFrames={SCENES.hook.duration}>
        <Cross duration={SCENES.hook.duration}>
          <Hook />
        </Cross>
      </Sequence>
      <Sequence from={SCENES.problem.from} durationInFrames={SCENES.problem.duration}>
        <Cross duration={SCENES.problem.duration}>
          <Problem />
        </Cross>
      </Sequence>
      <Sequence from={SCENES.brand.from} durationInFrames={SCENES.brand.duration}>
        <Cross duration={SCENES.brand.duration}>
          <Brand />
        </Cross>
      </Sequence>
      <Sequence from={SCENES.principles.from} durationInFrames={SCENES.principles.duration}>
        <Cross duration={SCENES.principles.duration}>
          <Principles />
        </Cross>
      </Sequence>
      <Sequence from={SCENES.numbers.from} durationInFrames={SCENES.numbers.duration}>
        <Cross duration={SCENES.numbers.duration}>
          <Numbers />
        </Cross>
      </Sequence>
      <Sequence from={SCENES.cta.from} durationInFrames={SCENES.cta.duration}>
        {/* final scene holds — no cross-out */}
        <AbsoluteFill>
          <Cta />
        </AbsoluteFill>
      </Sequence>

      {/* music: fade in, gentle bed under the visuals, fade out at end */}
      <Audio
        src={staticFile(MUSIC)}
        volume={(f) => {
          const fadeIn = interpolate(f, [0, 50], [0, 0.3], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const fadeOut = interpolate(f, [TOTAL_FRAMES - 70, TOTAL_FRAMES - 10], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return fadeIn * fadeOut;
        }}
      />
    </AbsoluteFill>
  );
};
