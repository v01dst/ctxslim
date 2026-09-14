import React, { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

const fontFamilies = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url('${staticFile("fonts/Inter-var.woff2")}') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  src: url('${staticFile("fonts/JetBrainsMono-400.woff2")}') format('woff2');
}
`;

export const Fonts: React.FC = () => {
  const [handle] = useState(() =>
    delayRender("Loading fonts", { timeoutInMilliseconds: 30000 })
  );

  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = fontFamilies;
    document.head.appendChild(style);

    // prefetch icon path data for the ChipField (non-blocking for fonts)
    import("./Chips").then((m) => m.prefetchIcons());

    Promise.all([
      document.fonts.load("400 48px Inter"),
      document.fonts.load("700 48px Inter"),
      document.fonts.load("400 48px 'JetBrains Mono'"),
    ]).finally(() => continueRender(handle));

    return () => {
      style.remove();
    };
  }, [handle]);

  return null;
};
