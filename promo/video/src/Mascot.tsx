import React from "react";
import { theme } from "./theme";

export const Mascot: React.FC<{
  size: number;
  wink?: number;
  belt?: boolean;
  light?: boolean;
}> = ({ size, wink = 0, belt = true, light = false }) => {
  const s = size / 512;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      style={{ transform: "rotate(-4deg)" }}
    >
      <defs>
        <linearGradient id="vidBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7ee081" />
          <stop offset="55%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <linearGradient id="vidBand" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <radialGradient id="vidGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse
        cx="256"
        cy="436"
        rx="120"
        ry="22"
        fill="#000"
        opacity={light ? 0.1 : 0.35}
      />

      <path
        d="M256 92 C338 92 372 168 372 268 C372 372 330 428 256 428 C182 428 140 372 140 268 C140 168 174 92 256 92 Z"
        fill="url(#vidBody)"
        stroke="#166534"
        strokeWidth={10}
        strokeLinejoin="round"
      />

      <path
        d="M236 116 C206 138 194 176 196 216"
        stroke="#bbf7d0"
        strokeWidth={14}
        fill="none"
        strokeLinecap="round"
        opacity={0.85}
      />
      <path
        d="M320 150 C338 178 344 210 342 244"
        stroke="#bbf7d0"
        strokeWidth={12}
        fill="none"
        strokeLinecap="round"
        opacity={0.6}
      />

      <ellipse
        cx={204}
        cy={222}
        rx={34}
        ry={34 * (1 - wink * 0.85)}
        fill="#fff"
      />
      <ellipse
        cx={308}
        cy={222}
        rx={34}
        ry={34 * (1 - wink * 0.85)}
        fill="#fff"
      />
      <circle cx={212} cy={222} r={16} fill="#0f172a" opacity={1 - wink} />
      <circle cx={300} cy={222} r={16} fill="#0f172a" opacity={1 - wink} />
      <circle cx={218} cy={212} r={6} fill="#fff" opacity={1 - wink} />
      <circle cx={306} cy={212} r={6} fill="#fff" opacity={1 - wink} />
      <path
        d="M172 220 Q204 200 236 220"
        stroke="#166534"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        opacity={wink}
      />
      <path
        d="M276 220 Q308 200 340 220"
        stroke="#166534"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        opacity={wink}
      />

      <path
        d="M258 258 L236 292 L280 292 Z"
        fill="#86efac"
        stroke="#166534"
        strokeWidth={6}
        strokeLinejoin="round"
      />

      <path
        d="M212 330 Q256 360 300 330"
        stroke="#14532d"
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
      />

      {belt ? (
        <g>
          <rect
            x={136}
            y={306}
            width={240}
            height={64}
            rx={32}
            fill="url(#vidBand)"
          />
          <rect
            x={136}
            y={306}
            width={240}
            height={64}
            rx={32}
            fill="none"
            stroke="#0e7490"
            strokeWidth={6}
          />
          <circle cx={256} cy={338} r={20} fill="#f8fafc" />
          <path
            d="M256 326 L256 350 M244 338 L268 338"
            stroke="#0e7490"
            strokeWidth={6}
            strokeLinecap="round"
          />
        </g>
      ) : null}
    </svg>
  );
};
