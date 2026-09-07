const enabled = process.stderr.isTTY === true && !process.env.NO_COLOR;

const wrap = (code: string, reset = "\x1b[0m") => (text: string): string => (enabled ? `${code}${text}${reset}` : text);

export const bold = wrap("\x1b[1m");
export const dim = wrap("\x1b[2m");
export const cyan = wrap("\x1b[36m");
export const green = wrap("\x1b[32m");
export const yellow = wrap("\x1b[33m");
export const red = wrap("\x1b[31m");
export const magenta = wrap("\x1b[35m");

export const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const BANNER = String.raw`
  ____ __  _        __         ____  _ _
 / ___/ /_(_)_ __  / /  ___   / ___|| (_) ___ _ __ ___
/ /   / / / /\ \/ / /  / __| | |  __| | |/ _ \ '__/ __|
/ /__/ / / /  >  </ /__| (__  | |__ | | |  __/ |  \__ \
\____/_/ /_/ /_/\_\____|\___|  \____||_|_|\___|_|  |___/
`;
