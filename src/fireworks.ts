import { PALETTES } from "./scene.ts";
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
  /** 采样步长（迁移容差与接触半径用）。 */
  step: number;
  /** 目标 AABB（捕获早退用）。 */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** 目标空间桶：cellKey → 目标下标。 */
  grid: Map<number, number[]>;
  gridCell: number;
  gridCols: number;
  /** 场景种子驱动的 PRNG，火箭初速/爆炸分布/字形都用它。 */
  rng: () => number;
  textSize: number;
  /** 采样时使用的整句排版，供低动态完成态在 ASCII 下方绘制等大填充。 */
  textFontSize: number;
  textLines: string[];
  lastBlastX: number;
  lastBlastY: number;
}

export const PARTICLE_CAP = 1200;
/** 目标点上限占全局上限的比例：其余留给升空、装饰与在途补字。 */
const TEXT_SHARE = 0.55;
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
const TRAIL_INTERVAL = 0.02;
const REDUCED_CAP = 420;
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
    textFontSize: GLYPH_SIZE,
    textLines: [],
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
  world.textFontSize = GLYPH_SIZE;
  world.textLines = [];
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
  // 装饰降级：粒子接近上限时跳过尾迹，保证粘点与在途补字不被挤掉
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
          life: 0.35,
          maxLife: 0.35,
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
  emitSparks(world, batch.x, batch.y, 18 + Math.floor(rng() * 10), {
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
      glyph: GLYPHS[(rng() * GLYPHS.length) | 0] ?? ".",
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
      glyph: GLYPHS[(world.rng() * GLYPHS.length) | 0] ?? ".",
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
 * 单行祝福自动尝试 1–3 行，取可用字号最大的排法；显式换行保持作者原样。
 * 切分优先落在空格/标点/CJK 边界，超长连续单词才从词内断开。
 */
export function layoutTextLines(
  message: string,
  safeW: number,
  safeH: number,
  measure: (text: string) => number,
): string[] {
  const explicit = message.split("\n");
  if (explicit.length !== 1) return explicit;

  const chars = Array.from(message);
  const fit = (lines: string[]): number =>
    clamp(
      Math.min(
        (safeW * 100) / Math.max(...lines.map(measure)),
        safeH / (lines.length * 1.35),
      ),
      16,
      140,
    );
  let best = explicit;
  let bestSize = fit(best);

  for (let count = 2; count <= Math.min(3, chars.length); count++) {
    const candidate: string[] = [];
    let start = 0;
    for (let remaining = count; remaining > 1; remaining--) {
      const target = measure(chars.slice(start).join("")) / remaining;
      let cut = start + 1;
      let score = Number.POSITIVE_INFINITY;
      for (let i = cut; i <= chars.length - remaining + 1; i++) {
        const insideWord =
          /[A-Za-z0-9_]/.test(chars[i - 1] ?? "") &&
          /[A-Za-z0-9_]/.test(chars[i] ?? "");
        const next =
          Math.abs(measure(chars.slice(start, i).join("").trim()) - target) +
          +insideWord * target * 0.25;
        if (next < score) [cut, score] = [i, next];
      }
      candidate.push(chars.slice(start, cut).join("").trim());
      start = cut;
    }
    candidate.push(chars.slice(start).join("").trim());
    const size = fit(candidate);
    if (size > bestSize) [best, bestSize] = [candidate, size];
  }

  return best;
}

/**
 * 显示祝福到离屏画布并采样成目标点。字号按安全区自适应，采样步长决定点阵疏密，
 * 目标数受 `TEXT_SHARE` 约束。返回扫描序点集（顺序即目标身份 `order`）。
 * 这是唯一的 DOM 入口；纯逻辑在 `applyTargets` 里。
 */
function sampleTargets(world: World, message: string): Point[] {
  const { w, h } = world.view;
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const ctx = measureContext(cw, ch);
  if (!ctx) return [];

  const safeW = w * 0.86;
  const safeH = h * 0.72;
  ctx.font = `700 100px ${TEXT_FONT}`;
  const lines = layoutTextLines(
    message,
    safeW,
    safeH,
    (line) => ctx.measureText(line).width,
  );
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const sizeByWidth = widest > 0 ? (safeW * 100) / widest : 140;
  const sizeByHeight = safeH / (lines.length * 1.35);
  const size = clamp(Math.min(sizeByWidth, sizeByHeight), 16, 140);
  const step = Math.round(clamp(size / 8, 5, 16));
  const lineHeight = 1.35 * size;

  ctx.font = `700 ${size}px ${TEXT_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i] ?? "",
      w / 2,
      h / 2 + (i - (lines.length - 1) / 2) * lineHeight,
    );
  }
  // JetBrains Mono 字宽约为字号的 0.6 倍；1.4 倍字号能填满采样格而不横向重叠。
  world.textSize = step * 1.4;
  world.textFontSize = size;
  world.textLines = lines;
  world.step = step;

  const data = ctx.getImageData(0, 0, cw, ch).data;
  const limit = Math.floor(world.cap * TEXT_SHARE);
  const points: Point[] = [];
  // y 外层、x 内层：扫描序即身份顺序，重放与迁移都确定（不洗牌）
  for (let y = 0; y < ch; y += step) {
    for (let x = 0; x < cw; x += step) {
      if ((data[(y * cw + x) * 4 + 3] ?? 0) > 128) points.push({ x, y });
    }
  }
  if (points.length <= limit) return points;
  // 超限按固定步幅抽稀：沿扫描序均匀丢弃，保证每个字的主要笔画都留下采样点
  const stride = Math.ceil(points.length / limit);
  const thinned: Point[] = [];
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i];
    if (p) thinned.push(p);
  }
  return thinned;
}

/** 重新采样并迁移目标（DOM 包装）；空祝福清空目标，避免旧字残影。 */
export function refreshTargets(world: World): void {
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
  points: Point[],
  step: number,
): void {
  const prev = world.targets;
  const next: Target[] = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    order: i,
    state: "free",
    holder: null,
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
  /** 给定时整朵用同一速度档（收尾小烟花），否则用玩家爆炸的分布。 */
  speed?: number;
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
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + (rng() - 0.5) * 0.16;
    const ember = opts.speed === undefined && rng() < 0.22;
    const speed = opts.speed ?? 70 + rng() * 160;
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
  const n = Math.floor(
    (56 + Math.floor(world.rng() * 34)) * (world.reducedMotion ? 0.4 : 1),
  );
  world.blasts++;
  world.playerBlasts++;
  world.lastBlastX = rocket.x;
  world.lastBlastY = rocket.y;
  // 粘附资格在爆炸生成瞬间决定：收尾开始后的新爆炸天生没有资格
  emitSparks(world, rocket.x, rocket.y, n, {
    glue: world.phase === "playing",
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
  let excess = world.particles.length - world.cap;
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
    // 取代原先盖在 ASCII 上方的小号 DOM 兜底：仅低动态完成态绘制等大半透明底字。
    if (
      world.reducedMotion &&
      world.phase === "settled" &&
      world.textLines.length > 0
    ) {
      ctx.font = `700 ${world.textFontSize}px ${TEXT_FONT}`;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = world.palette.glow;
      alpha = 0.2;
      color = world.palette.glow;
      const lineHeight = world.textFontSize * 1.35;
      for (let i = 0; i < world.textLines.length; i++) {
        ctx.fillText(
          world.textLines[i] ?? "",
          w / 2,
          h / 2 + (i - (world.textLines.length - 1) / 2) * lineHeight,
        );
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
