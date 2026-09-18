/**
 * 场景配置：校验、URL Fragment 解析与序列化。
 * 零 import、零 DOM 依赖，Node 可直接执行（见 scene.test.ts）。
 */

/** 码点上限（spec 04 §3.1）：URL 分享安全线推导，不再是性能数。 */
export const MAX_CHARS = 200;
/** 显式行数与自动候选行数上限（spec 04 §3.1）；折行结果可超出此值（§4.3-3）。 */
export const MAX_LINES = 8;
export const PALETTE_IDS = ["rose", "amber", "aurora", "mono"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export interface Palette {
  id: PaletteId;
  label: string;
  bg1: string;
  bg2: string;
  rocket: string;
  sparks: [string, string, string];
  glow: string;
}

export interface SceneConfig {
  version: 1;
  message: string;
  palette: PaletteId;
  seed: number;
}

export const PALETTES: Record<PaletteId, Palette> = {
  rose: {
    id: "rose",
    label: "玫瑰",
    bg1: "#15101c",
    bg2: "#050409",
    rocket: "#ffe3ee",
    sparks: ["#ff8fbe", "#ff5f9e", "#ffd0a8"],
    glow: "#ff3d7f",
  },
  amber: {
    id: "amber",
    label: "琥珀",
    bg1: "#181208",
    bg2: "#060403",
    rocket: "#ffeec2",
    sparks: ["#ffc857", "#ff9f1c", "#fff0bf"],
    glow: "#ff8c2b",
  },
  aurora: {
    id: "aurora",
    label: "极光",
    bg1: "#08131a",
    bg2: "#03060a",
    rocket: "#d9fff7",
    sparks: ["#5ef2c0", "#7ad7ff", "#c9a7ff"],
    glow: "#4fd1c5",
  },
  mono: {
    id: "mono",
    label: "墨白",
    bg1: "#141414",
    bg2: "#050505",
    rocket: "#f5f5f5",
    sparks: ["#ffffff", "#d4d4d4", "#a3a3a3"],
    glow: "#e5e5e5",
  },
};

export const DEFAULT_SCENE: SceneConfig = {
  version: 1,
  message: "",
  palette: "rose",
  seed: 240520,
};

export function countCodepoints(s: string): number {
  return [...s].length;
}

/** 编辑器输入路径：先规范化，再按码点截断到 MAX_CHARS、按行截断到 MAX_LINES 行。 */
export function clampMessage(raw: string): string {
  const lines = normalizeMessage(raw).split("\n").slice(0, MAX_LINES);
  return normalizeMessage([...lines.join("\n")].slice(0, MAX_CHARS).join(""));
}

/**
 * URL 路径：换行统一、去控制字符、折叠空行、去首尾空白。
 * 不做 Unicode 归一化（NFKC 等会改写用户文字）。
 */
export function normalizeMessage(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isValidMessage(s: string): boolean {
  return (
    s !== "" &&
    s === normalizeMessage(s) &&
    countCodepoints(s) <= MAX_CHARS &&
    s.split("\n").length <= MAX_LINES
  );
}

export function isPaletteId(v: string): v is PaletteId {
  return (PALETTE_IDS as readonly string[]).includes(v);
}

function isSeed(v: string): boolean {
  return /^\d{1,10}$/.test(v) && Number(v) <= 4294967295;
}

export function readSceneFromHash(
  hash: string,
  fallback: SceneConfig = DEFAULT_SCENE,
): SceneConfig {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const v = params.get("v");
  if (v !== null && v !== "1") return { ...fallback };

  const m = params.get("m");
  const p = params.get("p");
  const s = params.get("s");
  const message = m === null ? fallback.message : normalizeMessage(m);

  return {
    version: 1,
    message: m !== null && isValidMessage(message) ? message : fallback.message,
    palette: p !== null && isPaletteId(p) ? p : fallback.palette,
    seed: s !== null && isSeed(s) ? Number(s) : fallback.seed,
  };
}

/** encodeURIComponent 写、URLSearchParams 读；空文案省略 m，p/s 恒写出。 */
export function writeSceneToHash(scene: SceneConfig): string {
  const parts = ["v=1"];
  if (scene.message !== "")
    parts.push(`m=${encodeURIComponent(scene.message)}`);
  parts.push(`p=${scene.palette}`, `s=${scene.seed}`);
  return `#${parts.join("&")}`;
}

/** 覆盖已有 Fragment，不重复追加。 */
export function buildShareUrl(baseUrl: string, scene: SceneConfig): string {
  return baseUrl.split("#")[0] + writeSceneToHash(scene);
}
