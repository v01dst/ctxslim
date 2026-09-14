export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const SCENES = {
  hook: { from: 0, duration: 240 },
  problem: { from: 240, duration: 300 },
  brand: { from: 540, duration: 240 },
  principles: { from: 780, duration: 360 },
  numbers: { from: 1140, duration: 300 },
  cta: { from: 1440, duration: 360 },
} as const;

export const TOTAL_FRAMES = 1800;

export const theme = {
  bg: "#ffffff",
  ink: "#0d0d0d",
  gray: "#6b6b6b",
  faint: "#ececec",
  panel: "#f7f7f7",
  green: "#10a37f",
  greenDeep: "#0d8a6c",
  white: "#ffffff",
} as const;
