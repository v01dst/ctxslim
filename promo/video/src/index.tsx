import React from "react";
import { registerRoot, Composition } from "remotion";
import { CtxSlimPromo } from "./CtxSlimPromo";
import { FPS, HEIGHT, WIDTH, TOTAL_FRAMES } from "./theme";

registerRoot(() => (
  <Composition
    id="CtxSlimPromo"
    component={CtxSlimPromo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
));
