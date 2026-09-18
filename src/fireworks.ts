import { MAX_LINES, PALETTES, countCodepoints } from "./scene.ts";
import type { Palette, SceneConfig } from "./scene.ts";

/** 粒子种类。`text` 是占据祝福采样点的粒子，不参与寿命淘汰。 */
export type Kind = "rocket" | "trail" | "spark" | "ember" | "text";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 剩余秒数
  maxLife: number;
  glyph: string;
  color: string;
  kind: Kind;
  /** 生成瞬间决定：诞生在积累期、并抽中粘附资格的火花。 */
  glue?: boolean;
  /** 颜色角色：0..2 = sparks，3 = rocket/hot，4 = glow。换配色时按它重映射。 */
  tone?: number;
  /** 文字粒子占据的目标下标（唯一目标身份，不缓存坐标）。 */
  targetId?: number;
  /** 接触粘附过渡已用时（秒）；存在即"过渡中"。 */
  stickT?: number;
  /** 收尾飞入已用时 / 总时长（秒）。 */
  flightT?: number;
  flightDur?: number;
  /** 过渡或飞行的起点（接触点 / 小烟花位置）。 */
  fx?: number;
  fy?: number;
  /** 收尾飞行的侧向弧度（px，可负）。 */
  sway?: number;
  settled?: boolean;
  trailT?: number; // 单枚火箭自己的尾迹累加器
}

export type Phase = "loading" | "playing" | "revealing" | "settled";

/** 目标槽位状态：唯一占据，只有 `stuck` 计入完成度。 */
export type TargetState = "free" | "reserved" | "stuck";

export interface Target {
  x: number;
  y: number; // CSS px
  order: number; // 采样扫描序下标（迁移身份）
  state: TargetState;
  holder: Particle | null; // 占据者（对象引用，压缩数组后仍有效）
  /** 槽位推荐字形（spec 03 §2）；缺省时粒子保留自身字形，兼容旧 `Point[]` 注入。 */
  glyph?: string;
}

/** 收尾的一朵小烟花：负责一批缺口目标。 */
export interface Batch {
  idx: number[];
  x: number;
  y: number; // 绽放位置（该组目标的质心）
}

/** 采样点；扫描序即目标身份 `order`。 */
export interface Point {
  x: number;
  y: number;
}

/** 采样输出：位置 + 推荐字形（spec 03 §2）；向后兼容 spec 02 的 `Point`。 */
export interface GlyphTarget extends Point {
  /** 单个 ASCII 字符，属于 §6 的 9 字形子集。 */
  glyph: string;
}

/** 单元特征：`cellFeatures` 的输出（spec 03 §2），纯函数产物，Node 可测。 */
export interface CellFeatures {
  coverage: number; // 0..1，alpha 覆盖率
  cx: number; // 覆盖重心相对单元中心的 x 偏移（CSS px，已钳制）
  cy: number; // 覆盖重心相对单元中心的 y 偏移（CSS px，已钳制）
  edge: number; // 归一化边缘强度 0..1
  coherence: number; // 方向相干性 0..1（结构张量各向异性）
  angle: number; // 笔画方向角 deg ∈ [0,180)，y-down
}

/** 排版结果（spec 03 §2）：取代 `world.textFontSize` + `world.textLines`。 */
export interface TextLayout {
  lines: string[]; // 视觉行
  size: number; // 文字字号 px
  lineHeight: number; // size * 1.35
  cellW: number; // 最终单元宽 px（含预算缩放 k）
  cellH: number; // 最终单元高 px
  scale: number; // 实际 k（诊断与调参用）
}

/** 文字遮罩（spec 03 §4.3）：`alpha` 长度 `w * h`，是单元特征的唯一事实来源。 */
export interface Mask {
  alpha: Uint8Array;
  w: number;
  h: number;
  /** 遮罩分辨率倍数（每 CSS px 的遮罩 px 数）。 */
  s: number;
}

/** Unicode 分段结果（spec 03 §4.1）；`ranks[i]` 是第 i 个字素前的断点优先级。 */
export interface TextRun {
  /** 显式 `\n` 段落，原样保留（含空段）。 */
  segments: string[];
  /** 与 `segments` 平行：每段的字素数组。 */
  graphemes: string[][];
  /** 与 `graphemes` 平行：断点优先级，0 = 词/字素边界，1 = 词内（施加偏好惩罚）。 */
  ranks: number[][];
}

export interface View {
  w: number;
  h: number;
  dpr: number;
}

export interface WorldOptions {
  reducedMotion?: boolean;
  cap?: number;
}

export interface World {
  /** 总爆炸数（含收尾小烟花）→ 音效/调试。 */
  blasts: number;
  /** 玩家火箭爆炸数 = 轮数；只有它触发收尾。 */
  playerBlasts: number;
  cap: number;
  reducedMotion: boolean;
  scene: SceneConfig;
  palette: Palette;
  view: View;
  particles: Particle[];
  phase: Phase;
  /** 空数组 = 无可显文字（空祝福或目标已被结构性变更清空）。 */
  targets: Target[];
  /** 已落定槽位数（完成度分子）。 */
  stuck: number;
  /** 已预留在途槽位数。 */
  reserved: number;
  /** 全阶段模拟时钟（呼吸相位）。 */
  clock: number;
  /** 收尾累计（revealing 期间）。 */
  finaleT: number;
  /** 完成累计（settled 期间）→ 颜色统一进度。 */
  settleT: number;
  /** 下一波小烟花的倒计时，以及本次排程固定的波大小/间隔。 */
  batchTimer: number;
  batchSize: number;
  batchInterval: number;
  /** 待绽放批次；在途粒子不在队列里。 */
  queue: Batch[];
  /** 接触半径（由采样步长推导）。 */
  captureR: number;
  /** 采样步长 = `cellH`（spec 03 §4.5）；迁移容差与接触半径的尺度基准。 */
  step: number;
  /** 目标 AABB（捕获早退用）。 */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** 目标空间桶：cellKey → 目标下标。 */
  grid: Map<number, number[]>;
  gridCell: number;
  gridCols: number;
  /** 场景种子驱动的 PRNG，火箭初速/爆炸分布/字形都用它。 */
  rng: () => number;
  /** 粒子字号 = `cellH`（spec 03 §4.5）。 */
  textSize: number;
  /** 整句排版（spec 03 §2）：方向化采样的单一事实来源；结构性重置时置 `null`。 */
  textLayout: TextLayout | null;
  lastBlastX: number;
  lastBlastY: number;
}

export const PARTICLE_CAP = 1800;
// ---- spec 04 §3.1：文字预算常量（★ 未验证基线，经 §8 矩阵后回写）----
/**
 * 每字素文字目标数上限，取代 `TEXT_SHARE` 份额制。
 * 产品决策（2026-09「继续提升单字 ASCII 密度」）：40 → 64 —— raw 峰值（spec 04 §2.2，
 * 大字号 ≈ 55–88 点/字）不再被削平，短祝福每字密度 ×1.6。
 */
export const PER_GLYPH_BUDGET = 64;
/** 文字目标绝对天花板：语义是性能护栏，不是质量旋钮。产品决策：2400 → 4800（长祝福也变密）。 */
export const TEXT_HARD_CAP = 4800;
/** reduced motion 档的文字天花板（= 640 × 0.8，给零星火花留余量）。 */
export const REDUCED_TEXT_HARD_CAP = 512;
/** 装饰粒子保底额度（1 火箭 + 尾迹 + ~170 爆发火花，spec 04 §4.2）。 */
export const DECOR_FLOOR = 320;
/**
 * 文字点阵预算（spec 04 §4.1）：每字素 `PER_GLYPH_BUDGET`，总上限取对应档天花板。
 * 超预算时 `planCellScale` 只放大单元完整重生成，禁止抽稀（spec 03 §4.7）。
 */
export function textBudget(
  codepoints: number,
  reducedMotion: boolean,
): number {
  const hardCap = reducedMotion ? REDUCED_TEXT_HARD_CAP : TEXT_HARD_CAP;
  return Math.min(PER_GLYPH_BUDGET * codepoints, hardCap);
}
/** 玩家爆炸的火花数：基础 + 随机增量（reduced motion 再乘 0.4）。收尾小烟花另有更小的固定量。 */
export const BLAST_SPARKS_BASE = 170;
const BLAST_SPARKS_SPREAD = 90;
/**
 * 内核壳层（更大密度）：从本次爆炸的火花数里**切分**，不额外加量——
 * 外层保持原速率，内层速率 × 该系数并抖动 ±20%，形成双壳层、环心被填满。
 */
const BLAST_CORE_SHARE = 0.35;
/**
 * 内核壳层速率区间（× `SPARK_SPEED_MIN`）：从近静止连续铺到外层下限，
 * 逐粒子取值 → 半径从 0 铺到外层内缘，内核是**填满环心的盘**。
 * 旧实现（单速 × 0.45±20%）把全部内核粒子放在同一半径上，看上去是一个空心圈
 * —— 2026-09 修正（review/04 §4「双壳层观感」的未观察项）。
 */
const BLAST_CORE_SPEED_MIN = 0.1;
const BLAST_CORE_SPEED_MAX = 0.9;
/** 外层火花速率范围 px/s（更大范围）：爆炸半径 ≈ 速率 / `DAMP`。 */
export const SPARK_SPEED_MIN = 100;
const SPARK_SPEED_MAX = 330;
/** 收尾小烟花的火花数（同族但更小）。 */
const BLOOM_SPARKS_BASE = 26;
const BLOOM_SPARKS_SPREAD = 14;

/** 每次爆炸中带粘附资格的火花比例；保证整朵不会全冻在文字上。 */
const GLUE_SHARE = 0.45;
/** 接触半径 = clamp(step * CAPTURE_STEP_MUL, CAPTURE_MIN, CAPTURE_MAX)。 */
const CAPTURE_STEP_MUL = 1.2;
const CAPTURE_MIN = 8; // px
const CAPTURE_MAX = 24; // px：即"不允许远距离磁吸"的硬边界
/** 接触后减速到固定（秒）；不得变成持续游走。 */
export const STICK_TIME = 0.18;
/** 呼吸：仅 alpha，无位移；reduced motion 关闭。 */
const BREATH_DEPTH = 0.14;
const BREATH_HZ = 0.4;
/** 视口迁移匹配容差下限（px）。 */
const MIGRATE_MIN = 12;
/** 轮数阈值：只有玩家火箭爆炸计数能触发收尾。 */
const PLAYER_BLASTS_TO_FINALE = 10;
/** 预留安全期限（秒）：超时释放并重排，保证不留永久缺口。 */
const RESERVE_TTL = 3;
/** 收尾第一朵小烟花前的停顿（秒）。 */
const FINALE_LEAD = 0.35;
/** 收尾活动时长上限（秒）：与缺口数量、视口大小无关。 */
const FINALE_ACTIVITY = 2.6;
/** 最大波数：缺口再零碎也只分这么多波。 */
const FINALE_WAVE_MAX = 12;
/** 波间隔上下限（秒）：下限保证观感，上限保证缺口很少时不拖沓。 */
const FINALE_INTERVAL_MIN = 0.18;
const FINALE_INTERVAL_MAX = 0.8;
/** 收尾分区边长（px，局部性上界）。 */
const BATCH_CELL = 130;
/** 单朵补字火花上限。 */
const BATCH_MAX = 90;
/** 绽放点偏离缺口质心，避免单点缺口直接在终点生成粒子。 */
const BLOOM_OFFSET = 24;
/** 合并后的单朵最大飞行距离（px）。 */
export const MAX_FLIGHT = 170;
/** 补字飞行：时长 = clamp(d / speed, min, max)，末段自动减速落在目标。 */
const FILLER_SPEED = 220; // px/s
const FILLER_FLIGHT_MIN = 0.35; // s
const FILLER_FLIGHT_MAX = 1.2; // s
/** 侧向弧度上限，避免"激光直线"观感。 */
const FILLER_SWAY_MAX = 12; // px
/** reduced motion 下的就地淡入时长（秒）。 */
const FILLER_FADE = 0.35;
/** 落定后统一到主题高亮色的时长（秒）。 */
const COLOR_FADE = 0.8;

export const GLYPHS = [
  ".",
  "*",
  "+",
  ":",
  "*",
  ".",
  "/",
  "\\",
  "@",
  "|",
] as const;

const G = 220; // 重力 px/s²
const DAMP = 1.1; // 普通粒子线性阻尼系数
const GLYPH_SIZE = 13;
const GLYPH_FONT = `"ascii-mono", ui-monospace, monospace`;
const TEXT_FONT = `"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif`;

// ---- spec 03 §3：方向化 ASCII 文字基线（全部待视觉验证，集中此处调参）----
/** 遮罩分辨率倍数；内存超限时降为 1（§4.3-5）。 */
const SUPERSAMPLE = 2;
/** 遮罩像素上限（≈24MB ImageData）。 */
const MASK_PIXEL_CAP = 6_000_000;
/** baseCell = clamp(size / CELL_DIV, CELL_MIN, CELL_MAX)。 */
const CELL_DIV = 12;
/** px：低于此单元字形不可辨。产品决策（2026-09）：7 → 6，已触及原可辨下界，待真机矩阵复核。 */
export const CELL_MIN = 6;
/** px：上限即"ASCII 字形大小"上限。产品决策（2026-09）：12 → 10，每字格子数 ×1.44。 */
export const CELL_MAX = 10;
/** 预算自适应的单元放大上限。 */
export const K_MAX = 2.5;
/** 闭式外推留 10% 余量（覆盖率非严格 ∝ 1/k²）。 */
const BUDGET_SAFETY = 0.9;
/** 遮罩生成-计数尝试上限（每次尝试一次整幅 `getImageData`）。 */
export const MAX_ATTEMPTS = 3;
/** 低于此覆盖率不产生目标（去噪、去游丝）。 */
export const COVER_MIN = 0.08;
/** 高于此判为笔画内部。 */
export const COVER_DENSE = 0.55;
/**
 * 边缘强度阈值（归一化）。`edge = Σ|g| / (像素数 × EDGE_ALPHA_SCALE)`，即单元内
 * 平均梯度幅值（以 alpha 满幅为单位）；实测文字约 0.05–0.3，与 EDGE_MIN 配对，
 * 是 M13 的主要调参面之一。
 */
export const EDGE_MIN = 0.15;
const EDGE_ALPHA_SCALE = 255;
/** 相干性阈值：低于此判为交叉/转折。 */
export const COH_MIN = 0.5;
/** 重心偏移上限 = 0.25 × cell。 */
export const CENTROID_CLAMP = 0.25;
/** 托底不透明度（设计区间 0.1–0.15）。 */
export const BACKDROP_ALPHA = 0.12;
/** 托底渐入秒数（复用 `settleT`，不新增计时器）。 */
export const BACKDROP_FADE = 1.2;

// ---- 文字排版/几何（spec 03 §4.2 / §4.5）----
/** 安全区比例（spec 03 §4.2-1：86% × 72%）。 */
const SAFE_W = 0.86;
const SAFE_H = 0.72;
/** 字号范围与行高倍数（spec 03 §4.2-1、§4.5-3）。 */
const SIZE_MIN = 16;
const SIZE_MAX = 140;
const LINE_HEIGHT = 1.35;
/** 测量参考字号：整行 `measureText` 一次，其余字号按线性缩放（§4.2-3）。 */
const SIZE_REF = 100;
/** 断在词内的偏好惩罚（× 目标行宽）。 */
const CUT_PENALTY = 0.25;
/** 火箭尾迹生成间隔（秒）：累加器上限 50/s（每帧最多补 1 个，帧率低时按比例减少）。 */
const TRAIL_INTERVAL = 0.02;
/** 单枚尾迹寿命（秒，更长尾迹）：可见长度 ≈ 火箭速度 × 该值。 */
const TRAIL_LIFE = 0.7;
const REDUCED_CAP = 640;
const FOREVER = 1e9; // 文字粒子不再参与寿命淘汰
/** 装饰降级阈值：粒子数超过上限的这个比例就跳过尾迹。 */
const DENSE_SHARE = 0.8;

/** mulberry32 变体，返回 [0,1)。 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(
  scene: SceneConfig,
  view: View,
  opts: WorldOptions = {},
): World {
  const reducedMotion = opts.reducedMotion ?? false;
  return {
    blasts: 0,
    playerBlasts: 0,
    cap: opts.cap ?? (reducedMotion ? REDUCED_CAP : PARTICLE_CAP),
    reducedMotion,
    scene,
    palette: PALETTES[scene.palette],
    view,
    particles: [],
    phase: "playing",
    targets: [],
    stuck: 0,
    reserved: 0,
    clock: 0,
    finaleT: 0,
    settleT: 0,
    batchTimer: 0,
    batchSize: 0,
    batchInterval: 0,
    queue: [],
    captureR: CAPTURE_MIN,
    step: 0,
    bounds: { x0: 0, y0: 0, x1: 0, y1: 0 },
    grid: new Map(),
    gridCell: 16,
    gridCols: 1,
    rng: createRng(scene.seed),
    textSize: GLYPH_SIZE,
    textLayout: null,
    lastBlastX: view.w / 2,
    lastBlastY: view.h * 0.35,
  };
}

/** 保留归一化位置：换视口尺寸后粒子按比例缩放；目标点由 `refreshTargets` 迁移。 */
export function setViewport(world: World, view: View): void {
  const old = world.view;
  if (old.w > 0 && old.h > 0) {
    const sx = view.w / old.w;
    const sy = view.h / old.h;
    for (const p of world.particles) {
      p.x *= sx;
      p.y *= sy;
      if (p.fx !== undefined) p.fx *= sx;
      if (p.fy !== undefined) p.fy *= sy;
    }
    // 旧目标也必须进入新坐标系，随后 refreshTargets 才能正确比较并迁移占据。
    for (const t of world.targets) {
      t.x *= sx;
      t.y *= sy;
    }
  }
  world.view = view;
  world.bounds = boundsOf(world.targets);
  rebuildGrid(world);
}

/**
 * 应用场景：`seed` 或 `message` 变化是结构性变更，做与重放等价的完整重置
 * 并清空目标与网格（防止旧字残影被当作新进度）；只换配色则按 `tone` 重映射颜色。
 */
export function applyScene(world: World, scene: SceneConfig): void {
  const structural =
    scene.seed !== world.scene.seed || scene.message !== world.scene.message;
  world.scene = scene;
  world.palette = PALETTES[scene.palette];
  if (!structural) {
    recolor(world);
    return;
  }
  clearWorld(world);
  world.targets = [];
  world.grid.clear();
  world.bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  world.step = 0;
  world.captureR = CAPTURE_MIN;
  world.textSize = GLYPH_SIZE;
  world.textLayout = null;
  world.phase = "playing";
  world.rng = createRng(scene.seed);
}

/** 仅换配色：按 `tone` 重映射；没有 `tone` 的旧粒子退回按 kind 映射。 */
function recolor(world: World): void {
  const { sparks, rocket, glow } = world.palette;
  for (let i = 0; i < world.particles.length; i++) {
    const p = world.particles[i];
    if (!p) continue;
    const tone = p.tone;
    if (tone === 4) p.color = glow;
    else if (tone === 3) p.color = rocket;
    else if (tone !== undefined) p.color = sparks[tone] ?? glow;
    else if (p.kind === "text" || p.kind === "trail") p.color = glow;
    else if (p.kind === "rocket") p.color = rocket;
    else p.color = sparks[i % 3] ?? glow;
  }
}

export function launch(world: World, x: number, y?: number): void {
  const { h } = world.view;
  const apexY = clamp(y ?? h * 0.35, h * 0.15, h * 0.6);
  const vy0 = -Math.sqrt(2 * G * (h - apexY));
  world.particles.push({
    x,
    y: h + 12,
    vx: (world.rng() - 0.5) * 30,
    vy: vy0,
    life: 6,
    maxLife: 6,
    glyph: "|",
    color: world.palette.rocket,
    kind: "rocket",
    tone: 3,
    trailT: 0,
  });
}

/** 清空粒子与全部计数/时钟；槽位回 `free`（保留目标点与网格）；不重建 rng。 */
function clearWorld(world: World): void {
  world.particles.length = 0;
  world.blasts = 0;
  world.playerBlasts = 0;
  world.stuck = 0;
  world.reserved = 0;
  world.clock = 0;
  world.finaleT = 0;
  world.settleT = 0;
  world.batchTimer = 0;
  world.batchSize = 0;
  world.batchInterval = 0;
  world.queue.length = 0;
  for (const t of world.targets) {
    t.state = "free";
    t.holder = null;
  }
  world.lastBlastX = world.view.w / 2;
  world.lastBlastY = world.view.h * 0.35;
}

/** 完整重置：重播 = 从种子重新开始，两次播放的画面结构一致。 */
export function resetScene(world: World): void {
  clearWorld(world);
  world.phase = "playing";
  world.rng = createRng(world.scene.seed);
}

export function update(world: World, dt: number): void {
  const d = Math.min(dt, 1 / 30);
  world.clock += d;
  const damping = Math.exp(-DAMP * d);
  const { h } = world.view;
  // 装饰降级：粒子接近上限时跳过尾迹，保证粘点与在途补字不被挤掉。
  // spec 04 §4.2 已知交互（接受）：文字数 > cap × DENSE_SHARE 时尾迹永久跳过——
  // 长祝福下这是想要的省帧行为。
  const dense = world.particles.length > world.cap * DENSE_SHARE;
  // 本帧只积分已存在的粒子；新生成的尾迹/火花从下一帧开始参与
  const count = world.particles.length;

  for (let i = 0; i < count; i++) {
    const p = world.particles[i];
    if (!p) continue;

    if (p.kind === "text") {
      if (p.settled) continue;
      if (p.flightDur !== undefined) stepFlight(world, p, d);
      else if (p.targetId !== undefined) stepStick(world, p, d);
      continue;
    }

    if (p.kind === "rocket") {
      p.trailT = (p.trailT ?? 0) + d;
      p.vy += G * d;
      p.x += p.vx * d;
      p.y += p.vy * d;
      if (p.vy >= -8) {
        explode(world, p);
        p.life = 0;
        continue;
      }
      if (p.trailT >= TRAIL_INTERVAL && !dense) {
        p.trailT -= TRAIL_INTERVAL;
        world.particles.push({
          x: p.x,
          y: p.y,
          vx: p.vx * 0.3,
          vy: p.vy * 0.3,
          life: TRAIL_LIFE,
          maxLife: TRAIL_LIFE,
          glyph: TRAIL_GLYPHS[(world.rng() * TRAIL_GLYPHS.length) | 0] ?? ".",
          color: world.palette.glow,
          kind: "trail",
          tone: 4,
        });
      }
      continue;
    }

    // 接触检测需要本帧的运动线段，所以积分前记下起点
    const x0 = p.x;
    const y0 = p.y;
    p.vy += G * d;
    p.vx *= damping;
    p.vy *= damping;
    p.x += p.vx * d;
    p.y += p.vy * d;
    p.life -= d;

    if (
      p.kind === "ember" &&
      p.life / p.maxLife < 0.25 &&
      !world.reducedMotion
    ) {
      p.glyph = GLYPHS[(world.rng() * GLYPHS.length) | 0] ?? ".";
    }
    if (p.y > h + 40) p.life = 0;
    if (p.glue && p.life > 0) tryCapture(world, p, x0, y0);
  }

  compact(world);
  enforceCap(world);

  if (world.phase === "revealing") stepFinale(world, d);
  else if (world.phase === "settled") world.settleT += d;

  // 十轮触发；提前入口（#bloom）调用同一个 startFinale
  if (
    world.phase === "playing" &&
    world.targets.length > 0 &&
    world.playerBlasts >= PLAYER_BLASTS_TO_FINALE
  ) {
    startFinale(world);
  }
  // 完成判定只看 stuck：自然补齐可以 playing → settled 直跳
  if (world.targets.length > 0 && world.stuck === world.targets.length) {
    complete(world);
  }
}

/** 完成：`stuck === targets.length` 是唯一判定，此后位置与字形都不再变。 */
function complete(world: World): void {
  if (world.phase === "settled") return;
  world.phase = "settled";
  world.settleT = 0;
  world.queue.length = 0;
}

// ---- 收尾：分批、绽放、补齐 ----

/** 收尾：幂等；只由轮数或 `#bloom` 触发，与点击次数、自动烟花无关。 */
export function startFinale(world: World): void {
  if (world.phase !== "playing" || world.targets.length === 0) return;
  world.phase = "revealing";
  world.finaleT = 0;
  resetSchedule(world);
}

/** 重排缺口，并固定本轮波大小/间隔；不能随剩余队列重算而越拖越慢。 */
function resetSchedule(world: World): void {
  world.queue = planBatches(world);
  const waves = Math.min(world.queue.length, FINALE_WAVE_MAX);
  world.batchSize = waves === 0 ? 0 : Math.ceil(world.queue.length / waves);
  world.batchInterval =
    waves === 0
      ? 0
      : clamp(
          FINALE_ACTIVITY / waves,
          FINALE_INTERVAL_MIN,
          FINALE_INTERVAL_MAX,
        );
  world.batchTimer = FINALE_LEAD;
}

/**
 * 把缺口按局部性分批：`BATCH_CELL` 分区 → 过大的组按扫描序切片 →
 * 贪心合并相邻批次，硬约束是目标数 <= `BATCH_MAX` 且质心到组内最远 <= `MAX_FLIGHT`。
 */
function planBatches(world: World): Batch[] {
  const cells = new Map<number, number[]>();
  const cols = Math.max(1, Math.ceil(world.view.w / BATCH_CELL));
  for (let i = 0; i < world.targets.length; i++) {
    const t = world.targets[i];
    if (!t || t.state !== "free") continue;
    const key =
      Math.floor(t.y / BATCH_CELL) * cols + Math.floor(t.x / BATCH_CELL);
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }
  // 极端稠密/偏斜的单元格也必须同时满足数量与飞行距离上限。
  const groups: number[][] = [];
  for (const cell of cells.values()) groups.push(...splitBatch(world, cell));
  groups.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const merged: number[][] = [];
  for (const group of groups) {
    const last = merged[merged.length - 1];
    if (last && canMerge(world, last, group)) last.push(...group);
    else merged.push([...group]);
  }
  return merged.map((idx) => {
    const c = centroid(world, idx);
    let dx = world.view.w / 2 - c.x;
    let dy = world.view.h / 2 - c.y;
    let len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = 0;
      dy = c.y >= BLOOM_OFFSET ? -1 : 1;
      len = 1;
    }
    return {
      idx,
      x: clamp(c.x + (dx / len) * BLOOM_OFFSET, 0, world.view.w),
      y: clamp(c.y + (dy / len) * BLOOM_OFFSET, 0, world.view.h),
    };
  });
}

function centroid(world: World, idx: number[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const i of idx) {
    const t = world.targets[i];
    if (!t) continue;
    sx += t.x;
    sy += t.y;
    n++;
  }
  if (n === 0) return { x: 0, y: 0 };
  return { x: sx / n, y: sy / n };
}

function batchFits(world: World, idx: number[]): boolean {
  if (idx.length > BATCH_MAX) return false;
  const c = centroid(world, idx);
  return idx.every((i) => {
    const t = world.targets[i];
    return !t || Math.hypot(t.x - c.x, t.y - c.y) <= MAX_FLIGHT - BLOOM_OFFSET;
  });
}

/** 对不满足硬边界的单元格沿长轴二分；目标有限，因此必然收敛到单点。 */
function splitBatch(world: World, idx: number[]): number[][] {
  if (batchFits(world, idx)) return [idx];
  const xs = idx.map((i) => world.targets[i]?.x ?? 0);
  const ys = idx.map((i) => world.targets[i]?.y ?? 0);
  const splitX =
    Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const sorted = [...idx].sort((a, b) => {
    const ta = world.targets[a];
    const tb = world.targets[b];
    return (
      (splitX ? (ta?.x ?? 0) - (tb?.x ?? 0) : (ta?.y ?? 0) - (tb?.y ?? 0)) ||
      a - b
    );
  });
  const mid = Math.ceil(sorted.length / 2);
  return [
    ...splitBatch(world, sorted.slice(0, mid)),
    ...splitBatch(world, sorted.slice(mid)),
  ];
}

function canMerge(world: World, a: number[], b: number[]): boolean {
  return batchFits(world, a.concat(b));
}

/**
 * 一朵收尾小烟花：先放同族装饰，再为批内每个缺口生成一颗补字粒子。
 * 只计总爆炸数（供音效），不动 `playerBlasts`。
 */
function bloom(world: World, batch: Batch): void {
  const rng = world.rng;
  const { sparks } = world.palette;
  emitSparks(world, batch.x, batch.y, BLOOM_SPARKS_BASE + Math.floor(rng() * BLOOM_SPARKS_SPREAD), {
    speed: 60 + rng() * 90,
    life: 0.6 + rng() * 0.7,
  });
  for (const i of batch.idx) {
    const t = world.targets[i];
    if (!t || t.state !== "free") continue;
    const d = Math.hypot(t.x - batch.x, t.y - batch.y);
    const tone = (rng() * 3) | 0;
    const p: Particle = {
      x: batch.x,
      y: batch.y,
      vx: 0,
      vy: 0,
      life: FOREVER,
      maxLife: FOREVER,
      glyph: t.glyph ?? GLYPHS[(rng() * GLYPHS.length) | 0] ?? ".",
      color: sparks[tone] ?? sparks[0],
      kind: "text",
      tone,
      targetId: i,
      fx: batch.x,
      fy: batch.y,
      flightT: 0,
      flightDur: clamp(d / FILLER_SPEED, FILLER_FLIGHT_MIN, FILLER_FLIGHT_MAX),
      sway: (rng() * 2 - 1) * Math.min(FILLER_SWAY_MAX, d * 0.15),
    };
    if (world.reducedMotion) {
      // 就地淡入：位置从第一帧起就在目标上
      p.x = t.x;
      p.y = t.y;
      p.fx = t.x;
      p.fy = t.y;
      p.flightDur = FILLER_FADE;
      p.sway = 0;
    }
    t.state = "reserved";
    t.holder = p;
    world.reserved++;
    world.particles.push(p);
  }
  world.blasts++;
}

/** 收尾飞入：smoothstep 插值 + 侧向弧，末段减速落在目标（无瞬移兜底）。 */
function stepFlight(world: World, p: Particle, d: number): void {
  const idx = p.targetId;
  const t = idx === undefined ? undefined : world.targets[idx];
  const dur = p.flightDur;
  if (!t || dur === undefined) return;
  const u = clamp(((p.flightT ?? 0) + d) / dur, 0, 1);
  p.flightT = u * dur;
  const fx = p.fx ?? p.x;
  const fy = p.fy ?? p.y;
  const e = smoothstep(u);
  const dx = t.x - fx;
  const dy = t.y - fy;
  const len = Math.hypot(dx, dy) || 1;
  const arc = Math.sin(Math.PI * u) * (p.sway ?? 0);
  p.x = fx + dx * e + (-dy / len) * arc;
  p.y = fy + dy * e + (dx / len) * arc;
  if (u >= 1) settleInto(world, p, t);
}

/** 收尾调度：每波同时绽放若干朵小烟花，把活动时长压在 `FINALE_ACTIVITY` 内。 */
function stepFinale(world: World, d: number): void {
  world.finaleT += d;
  world.batchTimer -= d;
  if (world.batchTimer <= 0 && world.queue.length > 0) {
    for (let i = 0; i < world.batchSize && world.queue.length > 0; i++) {
      const batch = world.queue.shift();
      if (batch) bloom(world, batch);
    }
    world.batchTimer += world.batchInterval;
  }
  checkReservations(world);
}

/**
 * 预留安全网：正常情况下不会触发；保证"预留失效 → 释放补齐"在任何异常下都成立。
 * 预留时间就是粒子自己的过渡/飞行计时，不需要额外字段。
 */
function checkReservations(world: World): void {
  if (world.reserved === 0) return;
  let replan = false;
  for (const t of world.targets) {
    if (t.state !== "reserved") continue;
    const h = t.holder;
    const age = h ? Math.max(h.stickT ?? 0, h.flightT ?? 0) : RESERVE_TTL;
    if (h && h.life > 0 && age < RESERVE_TTL) continue;
    releaseSlot(world, t);
    replan = true;
  }
  if (replan && world.phase === "revealing") resetSchedule(world);
}

/** 槽位回 `free`，占据者退回有寿命的装饰火花。 */
function releaseSlot(world: World, t: Target): void {
  const h = t.holder;
  t.state = "free";
  t.holder = null;
  if (world.reserved > 0) world.reserved--;
  if (h) release(h);
}

/** 完成态重排：空目标立即补齐为已落定，保持整句完整。 */
function fillFree(world: World): void {
  const glow = world.palette.glow;
  for (let i = 0; i < world.targets.length; i++) {
    const t = world.targets[i];
    if (!t || t.state !== "free") continue;
    const p: Particle = {
      x: t.x,
      y: t.y,
      vx: 0,
      vy: 0,
      life: FOREVER,
      maxLife: FOREVER,
      glyph: t.glyph ?? GLYPHS[(world.rng() * GLYPHS.length) | 0] ?? ".",
      color: glow,
      kind: "text",
      tone: 4,
      targetId: i,
      settled: true,
    };
    t.state = "stuck";
    t.holder = p;
    world.particles.push(p);
  }
}

// ---- 目标：采样、迁移、空间桶 ----

let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

/** 离屏画布模块级复用：尺寸没变就不重新分配。 */
function measureContext(
  cw: number,
  ch: number,
): CanvasRenderingContext2D | null {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  if (measureCanvas.width !== cw) measureCanvas.width = cw;
  if (measureCanvas.height !== ch) measureCanvas.height = ch;
  if (!measureCtx) {
    measureCtx = measureCanvas.getContext("2d", { willReadFrequently: true });
  }
  return measureCtx;
}

/**
 * `Intl.Segmenter` 可用性（spec 03 §4.1-4）：一行判断，不引 polyfill。
 */
export function hasSegmenter(): boolean {
  return (
    typeof Intl !== "undefined" &&
    typeof (Intl as { Segmenter?: unknown }).Segmenter === "function"
  );
}

/**
 * 字素切分（spec 03 §4.1-2）：ZWJ 序列、emoji 修饰符、变体选择符、组合附加符保持原子。
 * `useIntl=false` 时退化为码点切分（Baseline 2024 之前环境）。
 */
export function splitGraphemes(text: string, useIntl = hasSegmenter()): string[] {
  if (!useIntl) return Array.from(text);
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(seg.segment(text), (s) => s.segment);
}

const WORD_CHAR = /[A-Za-z0-9_]/;
/** CJK/假名/谚文等逐字换行脚本：词段内部的这些字素边界仍是合法断点（§4.2-2 字素兜底）。 */
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

/**
 * 断点优先级（spec 03 §4.1-3 / §4.2-2）：0 = word 段边界（词首/空白/标点/CJK 单字），
 * 1 = ASCII 词内（施加偏好惩罚）。缺 `Intl.Segmenter` 时退化为
 * “"ASCII 词内” vs “其余””，与旧 `layoutTextLines` 行为一致。
 * 返回长度 `graphemes.length + 1`（首尾也是边界）。
 */
export function cutRanks(
  text: string,
  graphemes: string[],
  useIntl = hasSegmenter(),
): number[] {
  const ranks = new Array<number>(graphemes.length + 1).fill(0);
  if (!useIntl) {
    for (let i = 1; i < graphemes.length; i++) {
      if (WORD_CHAR.test(graphemes[i - 1] ?? "") && WORD_CHAR.test(graphemes[i] ?? "")) {
        ranks[i] = 1;
      }
    }
    return ranks;
  }
  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const words = Array.from(seg.segment(text));
  let wi = 0;
  let off = 0;
  for (let i = 0; i < graphemes.length; i++) {
    // 落在本字素起始偏移处的 word 段（超出则向后推进）
    while (wi < words.length) {
      const w = words[wi];
      if (w && w.index + w.segment.length <= off) wi++;
      else break;
    }
    const w = words[wi];
    // 词段内部才惩罚；词段内的 CJK 字素边界仍可断（§4.2-2）
    if (w && w.isWordLike && w.index !== off) {
      const prev = graphemes[i - 1] ?? "";
      const cur = graphemes[i] ?? "";
      if (!(CJK.test(prev) && CJK.test(cur))) ranks[i] = 1;
    }
    off += (graphemes[i] ?? "").length;
  }
  return ranks;
}

/** Unicode 分段（spec 03 §4.1）：显式 `\n` 先行且原样保留；`useIntl=false` 走码点兜底。 */
export function segmentText(message: string, useIntl = hasSegmenter()): TextRun {
  const segments = message.split("\n");
  const graphemes = segments.map((line) => splitGraphemes(line, useIntl));
  const ranks = segments.map((line, i) => cutRanks(line, graphemes[i] ?? [], useIntl));
  return { segments, graphemes, ranks };
}

/**
 * 单行祝福自动尝试 1–`MAX_LINES` 行，取可用字号最大的排法；显式换行是硬断行，保持作者原样
 * （spec 04 §4.3-1）。任一显式行在 `SIZE_MIN` 下超 safeW 时折行（§4.3-3）。
 * 断点优先级：word 段边界 > CJK 字素边界 > ASCII 词内（施加偏好惩罚）；
 * 宽度一律用整行 `measure(text, size)`（canvas 原生整形），不逐字素求和。
 */
export function layoutTextLines(
  message: string,
  safeW: number,
  safeH: number,
  measure: (text: string, size: number) => number,
  useIntl = hasSegmenter(),
): string[] {
  const explicit = message.split("\n");
  // spec 04 §4.3-3：长显式行折行，顺带修复旧版单行 40+ 字溢出安全区的缺陷；
  // 折行后行数可超 `MAX_LINES`（不溢出证明见 §4.3-4）
  let folded = false;
  const lines = explicit.flatMap((line) => {
    if (measure(line, SIZE_MIN) <= safeW) return [line];
    folded = true;
    return wrapLine(line, safeW, measure, useIntl);
  });
  if (folded || explicit.length !== 1) return lines;

  const { graphemes, ranks } = segmentText(message, useIntl);
  const gs = graphemes[0] ?? [];
  const cut = ranks[0] ?? [];
  // 用参考字号测一次、其余字号线性缩放（§4.2-3）；缓存由注入方负责
  const at = (from: number, to: number): number =>
    measure(gs.slice(from, to).join("").trim(), SIZE_REF);
  /** 未下限钳制的拟合字号：< `SIZE_MIN` 即溢出，候选不接受（spec 04 §4.3-2）。 */
  const fitRaw = (candidate: string[]): number =>
    Math.min(
      (safeW * SIZE_REF) /
        Math.max(...candidate.map((l) => measure(l, SIZE_REF))),
      safeH / (candidate.length * LINE_HEIGHT),
      SIZE_MAX,
    );
  let best = explicit;
  let bestSize = Math.max(fitRaw(best), SIZE_MIN);

  // spec 04 §4.3-2：候选 1–min(MAX_LINES, 字素数)；1 行候选就是显式行本身
  for (let count = 2; count <= Math.min(MAX_LINES, gs.length); count++) {
    const candidate: string[] = [];
    let start = 0;
    for (let remaining = count; remaining > 1; remaining--) {
      const target = measure(gs.slice(start).join(""), SIZE_REF) / remaining;
      let at2 = start + 1;
      let score = Number.POSITIVE_INFINITY;
      for (let i = at2; i <= gs.length - remaining + 1; i++) {
        const next =
          Math.abs(at(start, i) - target) + (cut[i] ?? 0) * CUT_PENALTY * target;
        if (next < score) [at2, score] = [i, next];
      }
      candidate.push(gs.slice(start, at2).join("").trim());
      start = at2;
    }
    candidate.push(gs.slice(start).join("").trim());
    const size = fitRaw(candidate);
    if (size >= SIZE_MIN && size > bestSize) [best, bestSize] = [candidate, size];
  }

  return best;
}

/**
 * 贪心折行（spec 04 §4.3-3）：在 `SIZE_MIN` 下取最长可容纳前缀，再回退到最近的词边界
 * （cut ranks = 0）；每行（除单字素本身就超宽的退化情形）在 `SIZE_MIN` 下 ≤ safeW。
 */
function wrapLine(
  line: string,
  safeW: number,
  measure: (text: string, size: number) => number,
  useIntl: boolean,
): string[] {
  const { graphemes, ranks } = segmentText(line, useIntl);
  const gs = graphemes[0] ?? [];
  const cut = ranks[0] ?? [];
  const at = (from: number, to: number): number =>
    measure(gs.slice(from, to).join("").trim(), SIZE_MIN);
  const out: string[] = [];
  let start = 0;
  while (start < gs.length) {
    // 宽度随前缀长度单调不减 → 二分找最长可容纳前缀
    let end = start + 1;
    for (let lo = start + 1, hi = gs.length; lo < hi; ) {
      const mid = (lo + hi + 1) >> 1;
      if (at(start, mid) <= safeW) lo = mid;
      else hi = mid - 1;
      end = lo;
    }
    for (let i = end; i > start + 1; i--) {
      if ((cut[i] ?? 0) === 0) {
        end = i;
        break;
      }
    }
    out.push(gs.slice(start, end).join("").trim());
    start = end;
  }
  return out;
}

// ---- 单元几何、遮罩特征与方向字形（spec 03 §4.4–§4.6，纯函数可注入测试）----

/**
 * 单元几何（spec 03 §4.5）：等宽字形横宽比 `ratio` 决定单元高。
 * `cellH` 取 floor 以构造性满足 `advance(cellH) ≤ cellW`（§10.1-11）；
 * spec §4.5 写 ceil，二者差 ≤1px，只影响亚像素留白，不改变点阵密度。
 */
export function cellMetrics(
  baseCell: number,
  k: number,
  ratio: number,
): { cellW: number; cellH: number } {
  const cellW = Math.ceil(baseCell * k);
  const cellH = Math.max(1, Math.floor(cellW / ratio));
  return { cellW, cellH };
}

/**
 * 单元特征（spec 03 §4.4）：alpha 覆盖率、重心、Sobel 梯度经结构张量聚合的方向角与
 * 相干性。纯运算无 DOM；`cx/cy` 是相对单元中心的 CSS px 偏移（已钳制
 * `±CENTROID_CLAMP × cell`），`scale` 是遮罩 px / CSS px。
 */
export function cellFeatures(
  alpha: ArrayLike<number>,
  maskW: number,
  maskH: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  scale = 1,
): CellFeatures {
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= maskW || y >= maskH ? 0 : (alpha[y * maskW + x] ?? 0);
  let sum = 0;
  let px = 0;
  let py = 0;
  let n = 0;
  let jxx = 0;
  let jyy = 0;
  let jxy = 0;
  let gsum = 0;
  for (let y = y0; y < y0 + ch; y++) {
    for (let x = x0; x < x0 + cw; x++) {
      const a = at(x, y);
      sum += a;
      px += a * x;
      py += a * y;
      n++;
      // 3×3 Sobel（外延 1px 取上下文）；梯度恒垂直于笔画
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1);
      jxx += gx * gx;
      jyy += gy * gy;
      jxy += gx * gy;
      gsum += Math.hypot(gx, gy);
    }
  }
  const coverage = n === 0 ? 0 : sum / (255 * n);
  const edge = n === 0 ? 0 : Math.min(1, gsum / (n * EDGE_ALPHA_SCALE));
  const trace = jxx + jyy;
  // 方向是 180° 周期的圆变量：张量主方向用二倍角形式，梯度⊥笔画须 +90°
  const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
  const angle = (theta * (180 / Math.PI) + 90 + 180) % 180;
  let cx = 0;
  let cy = 0;
  if (sum > 0) {
    const halfW = CENTROID_CLAMP * (cw / scale);
    const halfH = CENTROID_CLAMP * (ch / scale);
    // 像素索引的几何中心是 (n-1)/2（像素带面积），不是 n/2
    cx = clamp((px / sum - (x0 + (cw - 1) / 2)) / scale, -halfW, halfW);
    cy = clamp((py / sum - (y0 + (ch - 1) / 2)) / scale, -halfH, halfH);
  }
  return {
    coverage,
    cx,
    cy,
    edge,
    coherence: trace === 0 ? 0 : Math.hypot(jxx - jyy, 2 * jxy) / trace,
    angle,
  };
}

/** 方向 bin 字形（spec 03 §4.6）：y-down，横 / 右下斜 / 竖 / 右上斜。 */
const DIRECTION_GLYPHS = ["-", "\\", "|", "/"] as const;

/** 方向角 → bin（中心角 ±22.5°）：0 横 / 1 右下斜 / 2 竖 / 3 右上斜。 */
export function directionBin(angle: number): number {
  const a = ((angle % 180) + 180) % 180;
  return Math.floor((a + 22.5) / 45) % 4;
}

/**
 * 字形决策树（spec 03 §4.6）：内部类 → 方向类 → 交叉类 → 点缀类。
 * 随机只在同类内部且只用 `world.rng`；方向类与 `+` 无随机。
 */
export function pickGlyph(f: CellFeatures, rng: () => number): string {
  if (f.coverage >= COVER_DENSE) return rng() < 0.5 ? "@" : "*";
  if (f.edge >= EDGE_MIN) {
    if (f.coherence >= COH_MIN) {
      return DIRECTION_GLYPHS[directionBin(f.angle)] ?? "-";
    }
    return "+";
  }
  return rng() < 0.5 ? "." : ":";
}

/**
 * 遮罩 → 扫描序目标（spec 03 §4.4/§4.6/§4.8-1）：y 外层、x 内层；空单元
 * （覆盖率 < `COVER_MIN`）不产生目标；目标位置取重心而非格点。
 */
export function gridTargets(
  mask: Mask,
  cellW: number,
  cellH: number,
  originX: number,
  originY: number,
  rng: () => number,
): GlyphTarget[] {
  const cw = Math.max(1, Math.round(cellW * mask.s));
  const ch = Math.max(1, Math.round(cellH * mask.s));
  const points: GlyphTarget[] = [];
  for (let y = 0; y + ch <= mask.h; y += ch) {
    for (let x = 0; x + cw <= mask.w; x += cw) {
      const f = cellFeatures(mask.alpha, mask.w, mask.h, x, y, cw, ch, mask.s);
      if (f.coverage < COVER_MIN) continue;
      points.push({
        x: originX + (x + cw / 2) / mask.s + f.cx,
        y: originY + (y + ch / 2) / mask.s + f.cy,
        glyph: pickGlyph(f, rng),
      });
    }
  }
  return points;
}

/**
 * 预算自适应（spec 03 §4.7）：唯一出路是用更大的单元完整重生成，绝不事后抽稀。
 * `count(k)` 完整生成一次并返回目标数；返回最终 k、尝试次数与点数。
 */
export function planCellScale(
  budget: number,
  count: (k: number) => number,
): { k: number; attempts: number; n: number } {
  let k = 1;
  let n = 0;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    n = count(k);
    if (n <= budget || attempt === MAX_ATTEMPTS || k >= K_MAX) break;
    // 单元像素数 ≈ ∝ 1/k²；留 BUDGET_SAFETY 余量后回到更大的单元重新生成
    const next = k * Math.sqrt(n / Math.max(1, budget * BUDGET_SAFETY));
    k = clamp(next, k * 1.05, K_MAX);
  }
  return { k, attempts, n };
}

// ---- DOM：遮罩与度量 ----

let maskCanvas: HTMLCanvasElement | null = null;
let maskCtx: CanvasRenderingContext2D | null = null;

/** RGBA 数据 → 长度 `w*h` 的 alpha 通道。 */
function alphaOf(data: Uint8ClampedArray): Uint8Array {
  const n = data.length >> 2;
  const alpha = new Uint8Array(n);
  for (let i = 0, j = 3; i < n; i++, j += 4) alpha[i] = data[j] ?? 0;
  return alpha;
}

/**
 * 渲染文字遮罩（spec 03 §4.3）：紧凑包围盒 + 1 单元 padding，`willReadFrequently`
 * 保持 CPU 后端，整幅一次 `getImageData`；像素数超 `MASK_PIXEL_CAP` 时降 `SUPERSAMPLE`
 * 重绘（不调排版）。
 */
function renderTextMask(
  lines: string[],
  size: number,
  lineHeight: number,
  cellW: number,
  cellH: number,
): Mask | null {
  if (typeof document === "undefined") return null;
  if (!maskCanvas) maskCanvas = document.createElement("canvas");
  if (!maskCtx) {
    maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!maskCtx) return null;
  let mask = drawTextMask(
    maskCtx,
    maskCanvas,
    lines,
    size,
    lineHeight,
    cellW,
    cellH,
    SUPERSAMPLE,
  );
  if (mask.w * mask.h > MASK_PIXEL_CAP && mask.s > 1) {
    mask = drawTextMask(maskCtx, maskCanvas, lines, size, lineHeight, cellW, cellH, 1);
  }
  return mask;
}

/**
 * 行 i 相对文字块中心的纵向偏移。遮罩与完成态托底 MUST 共用这一公式，
 * 否则两种绘制的锚点会随字体度量漂移（spec 03 §5-3 „与点阵重合“）。
 */
function lineOffset(i: number, count: number, lineHeight: number): number {
  return (i - (count - 1) / 2) * lineHeight;
}

/**
 * 一次遮罩绘制（spec 03 §4.3）：锚点 = 视口中心，`textAlign=center` +
 * `textBaseline=middle`，与 `render` 的完成态托底同一锚点、同一行距。
 * 遮罩盒**对称**包住锚点：遮罩居中即锚点落在视口中心 → 点阵与托底逐像素重合（§5-3）。
 * 纵向留白取字体包围盒的一半（首末行墨迹不被裁）+ 1 个单元采样边距。
 */
function drawTextMask(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lines: string[],
  size: number,
  lineHeight: number,
  cellW: number,
  cellH: number,
  s: number,
): Mask {
  const fontPx = size * s;
  const font = `700 ${fontPx}px ${TEXT_FONT}`;
  ctx.font = font;
  const widest = Math.max(
    1,
    ...lines.map((line) => ctx.measureText(line).width),
  );
  // 字体包围盒（相对 alphabetic baseline）："middle" 锚点两侧各需 (asc + desc) / 2
  const metrics = ctx.measureText("Hg中");
  const asc = metrics.fontBoundingBoxAscent || fontPx * 0.9;
  const desc = metrics.fontBoundingBoxDescent || fontPx * 0.3;
  const padX = Math.ceil(cellW * s);
  const padY = Math.ceil(cellH * s);
  const halfW = widest / 2 + padX;
  const halfH = ((lines.length - 1) / 2) * lineHeight * s + (asc + desc) / 2 + padY;
  // 偶数尺寸 → 锚点落在整数像素上，避免半像素居中引入额外偏移
  const w = Math.max(2, 2 * Math.ceil(halfW));
  const h = Math.max(2, 2 * Math.ceil(halfH));
  canvas.width = w; // 重设尺寸会清空并重置上下文状态，随后重设字体
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const anchorX = w / 2;
  const anchorY = h / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i] ?? "",
      anchorX,
      anchorY + lineOffset(i, lines.length, lineHeight * s),
    );
  }
  return { alpha: alphaOf(ctx.getImageData(0, 0, w, h).data), w, h, s };
}

/** 整行 `measureText`（spec 03 §4.2-3）：参考字号测一次并缓存，其余字号线性缩放。 */
function cachedMeasure(
  ctx: CanvasRenderingContext2D,
): (text: string, size: number) => number {
  const cache = new Map<string, number>();
  return (text: string, size: number): number => {
    let v = cache.get(text);
    if (v === undefined) {
      ctx.font = `700 ${SIZE_REF}px ${TEXT_FONT}`;
      v = ctx.measureText(text).width;
      cache.set(text, v);
    }
    return (v * size) / SIZE_REF;
  };
}

/**
 * 显示祝福到离屏画布并采样成目标点（spec 03 §4.8-1）：分段 → 断行拟合 → 遮罩 →
 * 单元特征 → 字形映射 → 预算自适应。返回扫描序目标；这是唯一的 DOM 入口，
 * 纯逻辑（特征、字形、单元几何、预算）都在 `pure functions` 里可注入测试。
 */
function sampleTargets(world: World, message: string): GlyphTarget[] {
  const { w, h } = world.view;
  const ctx = measureContext(1, 1);
  if (!ctx) {
    world.textLayout = null;
    return [];
  }
  const measure = cachedMeasure(ctx);
  // 采样前实测等宽 advance 比（spec 03 §4.5-1：实测为准，不写死）
  const ratio = clamp(measure("0", SIZE_REF) / SIZE_REF, 0.2, 1);
  const safeW = w * SAFE_W;
  const safeH = h * SAFE_H;
  const lines = layoutTextLines(message, safeW, safeH, measure);
  const widest = Math.max(...lines.map((line) => measure(line, SIZE_REF)));
  const size = clamp(
    Math.min(
      widest > 0 ? (safeW * SIZE_REF) / widest : SIZE_MAX,
      safeH / (lines.length * LINE_HEIGHT),
    ),
    SIZE_MIN,
    SIZE_MAX,
  );
  const lineHeight = size * LINE_HEIGHT;
  const baseCell = clamp(size / CELL_DIV, CELL_MIN, CELL_MAX);
  // spec 04 §4.1：预算 = min(每字素上限 × 码点数, 对应档天花板)，与视口/总上限无关
  const budget = textBudget(countCodepoints(lines.join("")), world.reducedMotion);

  const seen = new Map<number, GlyphTarget[]>();
  const layoutAt = new Map<number, TextLayout>();
  const plan = planCellScale(budget, (k) => {
    const { cellW, cellH } = cellMetrics(baseCell, k, ratio);
    const mask = renderTextMask(lines, size, lineHeight, cellW, cellH);
    if (!mask) return Number.POSITIVE_INFINITY;
    const points = gridTargets(
      mask,
      cellW,
      cellH,
      (w - mask.w / mask.s) / 2,
      (h - mask.h / mask.s) / 2,
      world.rng,
    );
    seen.set(k, points);
    layoutAt.set(k, { lines, size, lineHeight, cellW, cellH, scale: k });
    return points.length;
  });
  const layout = layoutAt.get(plan.k);
  if (!layout) {
    world.textLayout = null;
    return [];
  }
  // `textSize` 与 `step` 都取 cellH（spec 03 §4.5-3、§2）
  world.textSize = layout.cellH;
  world.step = layout.cellH;
  world.textLayout = layout;
  return seen.get(plan.k) ?? [];
}

/** 重新采样并迁移目标（DOM 包装）；空祝福清空目标与排版，避免旧字残影。 */
export function refreshTargets(world: World): void {
  if (world.scene.message === "") world.textLayout = null;
  const points =
    world.scene.message === "" ? [] : sampleTargets(world, world.scene.message);
  applyTargets(world, points, world.step);
}

/**
 * 应用一组采样点：生成新槽位、按采样序比例迁移旧占据、重建空间桶并重新计数。
 * 纯函数（无 DOM），Node 可直接调用。
 */
export function applyTargets(
  world: World,
  points: Array<Point | GlyphTarget>,
  step: number,
): void {
  const prev = world.targets;
  const next: Target[] = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    order: i,
    state: "free",
    holder: null,
    // 有 `glyph` 则透传，旧 `Point[]` 注入留 undefined（spec 03 §4.8-2）
    glyph: (p as Partial<GlyphTarget>).glyph,
  }));
  migrate(prev, next, step);
  world.targets = next;
  world.step = step;
  world.captureR = clamp(step * CAPTURE_STEP_MUL, CAPTURE_MIN, CAPTURE_MAX);
  world.bounds = boundsOf(next);
  rebuildGrid(world);
  // 完成态重排：空目标立即补齐（保持完整，不播放动画）
  if (world.phase === "settled") fillFree(world);
  recount(world);
  // 收尾期重排缺口；在途补字粒子若 targetId 迁移成功则继续飞
  if (world.phase === "revealing") resetSchedule(world);
}

function boundsOf(targets: Target[]): World["bounds"] {
  if (targets.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of targets) {
    if (t.x < x0) x0 = t.x;
    if (t.y < y0) y0 = t.y;
    if (t.x > x1) x1 = t.x;
    if (t.y > y1) y1 = t.y;
  }
  return { x0, y0, x1, y1 };
}

/** 计数只由槽位扫描得到，避免增量记错。 */
function recount(world: World): void {
  let stuck = 0;
  let reserved = 0;
  for (const t of world.targets) {
    if (t.state === "stuck") stuck++;
    else if (t.state === "reserved") reserved++;
  }
  world.stuck = stuck;
  world.reserved = reserved;
}

/** 空间桶只存下标，查询时再按 `state` 过滤。 */
function rebuildGrid(world: World): void {
  const cell = Math.max(world.captureR * 2, 16);
  world.gridCell = cell;
  world.gridCols = Math.max(1, Math.ceil(world.view.w / cell));
  world.grid.clear();
  for (let i = 0; i < world.targets.length; i++) {
    const t = world.targets[i];
    if (!t) continue;
    const key =
      Math.floor(t.y / cell) * world.gridCols + Math.floor(t.x / cell);
    const bucket = world.grid.get(key);
    if (bucket) bucket.push(i);
    else world.grid.set(key, [i]);
  }
}

/**
 * 迁移旧占据：按采样序比例映射到新点集附近的最近空闲点；
 * 超出容差就释放成装饰火花——允许小幅覆盖差异，不凭空补成整句。
 */
function migrate(prev: Target[], next: Target[], step: number): void {
  if (prev.length === 0) return;
  const ratio = next.length / Math.max(1, prev.length);
  const win = Math.max(2, Math.ceil(ratio * 4));
  const tol = Math.max(1.5 * step, MIGRATE_MIN);
  for (const slot of prev) {
    const holder = slot.holder;
    if (!holder) continue;
    const base = Math.round(slot.order * ratio);
    const lo = Math.max(0, base - win);
    const hi = Math.min(next.length - 1, base + win);
    let best = -1;
    let bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const cand = next[i];
      if (!cand || cand.state !== "free") continue;
      const d = Math.hypot(cand.x - slot.x, cand.y - slot.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0 || bestD > tol) {
      release(holder);
      continue;
    }
    const cand = next[best];
    if (!cand) continue;
    holder.targetId = best;
    cand.holder = holder;
    // 迁移成功的占据者同步推荐字形（spec 03 §4.7-6）
    holder.glyph = cand.glyph ?? holder.glyph;
    if (holder.settled) {
      // 已落定的粘点必须始终等于目标坐标：迁移后直接贴上，不允许出现第四种位置
      cand.state = "stuck";
      holder.x = cand.x;
      holder.y = cand.y;
    } else {
      cand.state = "reserved";
    }
  }
}

/** 释放占据者：退回有寿命的装饰火花。 */
function release(p: Particle): void {
  p.kind = "spark";
  p.life = 0.4;
  p.maxLife = 0.4;
  p.settled = false;
  delete p.targetId;
  delete p.stickT;
  delete p.flightT;
  delete p.flightDur;
  delete p.sway;
  delete p.fx;
  delete p.fy;
}

// ---- 接触捕获与落定 ----

/**
 * 接触捕获：对路径线段附近的空间桶求最近空闲目标，命中则同帧完成
 * "槽位预留 + 粒子转文字"。颜色与字形保持不变（保留来源色）。
 * 不消耗 rng：位置驱动，保证重放确定性。
 */
function tryCapture(world: World, p: Particle, x0: number, y0: number): void {
  if (world.targets.length === 0) return;
  if (world.targets.length - world.stuck - world.reserved <= 0) return;
  const r = world.captureR;
  const b = world.bounds;
  const minX = Math.min(x0, p.x) - r;
  const maxX = Math.max(x0, p.x) + r;
  const minY = Math.min(y0, p.y) - r;
  const maxY = Math.max(y0, p.y) + r;
  // 早退：线段 AABB 与目标 AABB 不相交时远处烟花零成本
  if (maxX < b.x0 || minX > b.x1 || maxY < b.y0 || minY > b.y1) return;

  const cell = world.gridCell;
  const cols = world.gridCols;
  let best = -1;
  let bestD = Infinity;
  let bestOrder = Infinity;
  for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell); cy++) {
    for (
      let cx = Math.floor(minX / cell);
      cx <= Math.floor(maxX / cell);
      cx++
    ) {
      const bucket = world.grid.get(cy * cols + cx);
      if (!bucket) continue;
      for (const i of bucket) {
        const t = world.targets[i];
        if (!t || t.state !== "free") continue;
        const d = segmentDistance(t.x, t.y, x0, y0, p.x, p.y);
        if (d > r) continue;
        if (d < bestD || (d === bestD && t.order < bestOrder)) {
          bestD = d;
          bestOrder = t.order;
          best = i;
        }
      }
    }
  }
  if (best < 0) return;
  const slot = world.targets[best];
  if (!slot) return;

  slot.state = "reserved";
  slot.holder = p;
  world.reserved++;
  p.kind = "text";
  // 绑定即换形（spec 03 §4.8-3）：成为文字的那一刻定型槽位推荐字形
  p.glyph = slot.glyph ?? p.glyph;
  p.targetId = best;
  p.stickT = 0;
  p.fx = p.x;
  p.fy = p.y;
  p.life = FOREVER;
  p.maxLife = FOREVER;
  p.vx = 0;
  p.vy = 0;
  // reduced motion：就地淡入，位置从第一帧起就在目标上
  if (world.reducedMotion) {
    p.fx = slot.x;
    p.fy = slot.y;
    p.x = slot.x;
    p.y = slot.y;
  }
}

/** 点到线段的最短距离。 */
function segmentDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x0, py - y0);
  const u = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
  return Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
}

/** 接触粘附：从接触点减速插值到目标，然后固定（位置只有插值与终点两种）。 */
function stepStick(world: World, p: Particle, d: number): void {
  const idx = p.targetId;
  const t = idx === undefined ? undefined : world.targets[idx];
  if (!t) return;
  const u = Math.min(1, ((p.stickT ?? 0) + d) / STICK_TIME);
  p.stickT = u * STICK_TIME;
  const e = smoothstep(u);
  const fx = p.fx ?? p.x;
  const fy = p.fy ?? p.y;
  p.x = fx + (t.x - fx) * e;
  p.y = fy + (t.y - fy) * e;
  if (u >= 1) settleInto(world, p, t);
}

/** 落定：位置吸附到目标、槽位转 `stuck`，并清掉过渡字段。 */
function settleInto(world: World, p: Particle, t: Target): void {
  p.x = t.x;
  p.y = t.y;
  p.settled = true;
  delete p.stickT;
  delete p.flightT;
  delete p.flightDur;
  delete p.sway;
  delete p.fx;
  delete p.fy;
  if (t.state === "reserved") world.reserved--;
  t.state = "stuck";
  t.holder = p;
  world.stuck++;
}

interface SparkOptions {
  /** 整朵参与粘附抽签；缺省或 false 的火花天生没有资格。 */
  glue?: boolean;
  /**
   * 速率（px/s）：单值 = 整朵同速（收尾小烟花的细环，保留）；
   * 区间 = 逐粒子取速率（玩家爆炸内核，铺成填满环心的盘）；缺省 = 外层区间。
   */
  speed?: number | [number, number];
  life?: number;
}

/**
 * 火花环生成器：玩家爆炸与收尾小烟花共用同一函数（视觉同族但更小）。
 * `glue` 抽签属于爆炸随机序列的一部分，按火花逐一掷骰。
 */
function emitSparks(
  world: World,
  x: number,
  y: number,
  n: number,
  opts: SparkOptions = {},
): void {
  const rng = world.rng;
  const { sparks, rocket: hot } = world.palette;
  const spec = opts.speed;
  // 单值不抽骰（同速保留原随机序列）；缺省用外层区间
  const [vLo, vHi] =
    typeof spec === "number"
      ? [spec, spec]
      : (spec ?? [SPARK_SPEED_MIN, SPARK_SPEED_MAX]);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + (rng() - 0.5) * 0.16;
    const ember = spec === undefined && rng() < 0.22;
    const speed = vHi > vLo ? vLo + rng() * (vHi - vLo) : vLo;
    const life = opts.life ?? (ember ? 0.8 + rng() * 0.8 : 1.1 + rng() * 1.1);
    const tone = rng() < 0.08 ? 3 : i % 3;
    world.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed * (ember ? 0.5 : 1),
      vy: Math.sin(angle) * speed * (ember ? 0.5 : 1),
      life,
      maxLife: life,
      glyph: GLYPHS[(rng() * GLYPHS.length) | 0] ?? ".",
      color: tone === 3 ? hot : (sparks[tone] ?? hot),
      kind: ember ? "ember" : "spark",
      glue: opts.glue === true && rng() < GLUE_SHARE,
      tone,
    });
  }
}

function explode(world: World, rocket: Particle): void {
  const rng = world.rng;
  const n = Math.floor(
    (BLAST_SPARKS_BASE + Math.floor(rng() * BLAST_SPARKS_SPREAD)) *
      (world.reducedMotion ? 0.4 : 1),
  );
  world.blasts++;
  world.playerBlasts++;
  world.lastBlastX = rocket.x;
  world.lastBlastY = rocket.y;
  // 粘附资格在爆炸生成瞬间决定：收尾开始后的新爆炸天生没有资格
  const glue = world.phase === "playing";
  // 双壳层：先外层（现有观感），再内核盘填满环心；两层共享 `n` 的预算
  const core = Math.floor(n * BLAST_CORE_SHARE);
  emitSparks(world, rocket.x, rocket.y, n - core, { glue });
  emitSparks(world, rocket.x, rocket.y, core, {
    glue,
    speed: [
      SPARK_SPEED_MIN * BLAST_CORE_SPEED_MIN,
      SPARK_SPEED_MIN * BLAST_CORE_SPEED_MAX,
    ],
  });
}

/** 就地压缩：写指针覆盖，删除寿命耗尽的粒子。 */
function compact(world: World): void {
  const list = world.particles;
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const p = list[read];
    if (!p || p.life <= 0) continue;
    list[write++] = p;
  }
  list.length = write;
}

function enforceCap(world: World): void {
  // spec 04 §4.2：文字点阵可以超 `world.cap`（长祝福），所以上限先给装饰留 `DECOR_FLOOR` 保底，
  // 否则超额会静默地把火花/尾迹全裁掉。`world.targets.length` 是文字粒子数的恒等上界（spec 02 §3.3）：
  // 空祝福退化为 `max(cap, 320)`。
  const cap = Math.max(world.cap, world.targets.length + DECOR_FLOOR);
  let excess = world.particles.length - cap;
  if (excess <= 0) return;
  const kept: Particle[] = [];
  for (const p of world.particles) {
    // 按数组顺序丢弃最老的可抛弃粒子。火箭与文字不丢弃：前者是玩家的一次输入，
    // 后者只能由重播或结构性变更清除（因此粒子数可能短暂超过上限，超出的只有火箭）。
    if (excess > 0 && p.kind !== "text" && p.kind !== "rocket") {
      excess--;
      continue;
    }
    kept.push(p);
  }
  world.particles = kept;
}

const TRAIL_GLYPHS = [".", ":", "|"] as const;

export function render(ctx: CanvasRenderingContext2D, world: World): void {
  const { w, h, dpr } = world.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 层序：背景烟花 → 文字粒子（稳定后新烟花天然落在文字后方）
  ctx.font = `${GLYPH_SIZE}px ${GLYPH_FONT}`;
  let alpha = -1;
  let color = "";
  for (const p of world.particles) {
    if (p.kind === "text") continue;
    const a = clamp(p.life / p.maxLife, 0, 1);
    if (a !== alpha) {
      ctx.globalAlpha = a;
      alpha = a;
    }
    if (p.color !== color) {
      ctx.fillStyle = p.color;
      color = p.color;
    }
    ctx.fillText(p.glyph, p.x, p.y);
  }

  if (world.particles.some((p) => p.kind === "text")) {
    // 完成态托底（spec 03 §5）：低动态直接全量，常动态随 `settleT` 渐入；
    // 层序在文字粒子之下，与采样时同一排版/字号/行距，保证与点阵重合。
    const layout = world.textLayout;
    if (world.phase === "settled" && layout) {
      const a = world.reducedMotion
        ? BACKDROP_ALPHA
        : BACKDROP_ALPHA * smoothstep(clamp(world.settleT / BACKDROP_FADE, 0, 1));
      if (a > 0.001) {
        ctx.font = `700 ${layout.size}px ${TEXT_FONT}`;
        ctx.globalAlpha = a;
        ctx.fillStyle = world.palette.glow;
        alpha = a;
        color = world.palette.glow;
        for (let i = 0; i < layout.lines.length; i++) {
          ctx.fillText(
            layout.lines[i] ?? "",
            w / 2,
            h / 2 + lineOffset(i, layout.lines.length, layout.lineHeight),
          );
        }
      }
    }

    ctx.font = `${world.textSize}px ${GLYPH_FONT}`;
    // 呼吸只改亮度、不改位置；整段文字共享相位（逐点独立相位在小字号下像抖动）
    const breath = world.reducedMotion
      ? 1
      : 1 -
        BREATH_DEPTH *
          (0.5 + 0.5 * Math.sin(2 * Math.PI * BREATH_HZ * world.clock));
    for (const p of world.particles) {
      if (p.kind !== "text") continue;
      const a = p.settled
        ? breath
        : p.flightDur === undefined
          ? 0.35 + 0.65 * smoothstep((p.stickT ?? 0) / STICK_TIME)
          : clamp((p.flightT ?? 0) / FILLER_FADE, 0, 1);
      if (a !== alpha) {
        ctx.globalAlpha = a;
        alpha = a;
      }
      const c = textColor(world, p.color);
      if (c !== color) {
        ctx.fillStyle = c;
        color = c;
      }
      ctx.fillText(p.glyph, p.x, p.y);
    }
  }
  ctx.globalAlpha = 1;
}

function smoothstep(v: number): number {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 十六进制分量线性插值（`#rrggbb` → `rgb()`）；纯函数。 */
export function mixHex(from: string, to: string, t: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const mix = (shift: number): number =>
    Math.round(
      ((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t,
    );
  return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
}

// 按 (源色, 量化进度) 缓存：进度量化到 1/16，每个源色一行，避免逐粒子逐帧分配字符串
const mixCache = new Map<string, string[]>();

function unify(color: string, glow: string, progress: number): string {
  if (progress >= 1) return glow;
  let row = mixCache.get(color);
  if (!row || row[16] !== glow) {
    row = new Array<string>(17);
    row[16] = glow; // 换配色时整行失效
    mixCache.set(color, row);
  }
  const q = Math.round(progress * 16);
  const hit = row[q];
  if (hit !== undefined) return hit;
  const made = mixHex(color, glow, q / 16);
  row[q] = made;
  return made;
}

/** 文字层解析色：落定后从来源色柔和统一到主题高亮色；只改颜色。 */
export function textColor(world: World, color: string): string {
  const progress =
    world.phase === "settled"
      ? smoothstep(clamp(world.settleT / COLOR_FADE, 0, 1))
      : 0;
  return progress <= 0 ? color : unify(color, world.palette.glow, progress);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
