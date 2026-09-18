import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCENE, MAX_LINES } from "./scene.ts";
import type { SceneConfig } from "./scene.ts";
import {
  BACKDROP_ALPHA,
  BACKDROP_FADE,
  BLAST_SPARKS_BASE,
  CELL_MAX,
  CELL_MIN,
  CENTROID_CLAMP,
  COH_MIN,
  COVER_DENSE,
  COVER_MIN,
  DECOR_FLOOR,
  EDGE_MIN,
  K_MAX,
  MAX_ATTEMPTS,
  MAX_FLIGHT,
  PARTICLE_CAP,
  PER_GLYPH_BUDGET,
  REDUCED_TEXT_HARD_CAP,
  SPARK_SPEED_MIN,
  STICK_TIME,
  TEXT_HARD_CAP,
  applyTargets,
  cellFeatures,
  cellMetrics,
  createRng,
  createWorld,
  cutRanks,
  directionBin,
  gridTargets,
  hasSegmenter,
  launch,
  layoutTextLines,
  mixHex,
  pickGlyph,
  planCellScale,
  refreshTargets,
  render,
  resetScene,
  segmentText,
  setViewport,
  splitGraphemes,
  startFinale,
  textBudget,
  textColor,
  update,
} from "./fireworks.ts";
import type {
  CellFeatures,
  Mask,
  Particle,
  Point,
  World,
} from "./fireworks.ts";

const view = { w: 800, h: 600, dpr: 2 };
const scene = (patch: Partial<SceneConfig> = {}): SceneConfig => ({
  ...DEFAULT_SCENE,
  ...patch,
});

/** 按固定步长推进模拟（update 内部会把 dt 夹到 1/30）。 */
function step(world: World, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) update(world, dt);
}

/** 逐帧推进直到条件成立（或在时限内放弃）。 */
function stepUntil(
  world: World,
  pred: () => boolean,
  seconds = 3,
  dt = 1 / 60,
): boolean {
  for (let t = 0; t < seconds; t += dt) {
    update(world, dt);
    if (pred()) return true;
  }
  return pred();
}

/**
 * 均匀铺开的点阵（扫描序：y 外层、x 内层），代替依赖 DOM canvas 的采样。
 * 目标只由 `applyTargets` 注入，测试因此无需浏览器环境。
 */
function gridPoints(rows: number, cols: number): Point[] {
  const points: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        x: ((c + 0.5) * view.w) / cols,
        y: ((r + 0.5) * view.h) / rows,
      });
    }
  }
  return points;
}

/** 一颗可控的火花；默认带粘附资格。 */
function spark(patch: Partial<Particle> = {}): Particle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 5,
    maxLife: 5,
    glyph: "*",
    color: "#ffffff",
    kind: "spark",
    glue: true,
    ...patch,
  };
}

const textParticles = (world: World): Particle[] =>
  world.particles.filter((p) => p.kind === "text");

/** 注入度量：按 size 线性缩放的 0.5em/字（与真实 `measureText` 语义一致）。 */
const halfEm = (text: string, size: number): number =>
  (Array.from(text).length * 50 * size) / 100;
/** 注入度量：1em/字（CJK 近似），用于长行与窄屏。 */
const em = (text: string, size: number): number =>
  Array.from(text).length * size;

/** 每行在 `SIZE_MIN` 下都进安全区（spec 04 §3.2 / §4.3）。 */
const fitsAtMin = (lines: string[], safeW: number): boolean =>
  lines.every((line) => em(line, 16) <= safeW);

test("§10.1-4 单行长文案自动换行，短句与显式换行保持原样", () => {
  assert.deepEqual(
    layoutTextLines(
      "The quick brown fox jumps over the lazy dog.",
      860,
      400,
      halfEm,
    ),
    ["The quick brown", "fox jumps over", "the lazy dog."],
  );
  assert.deepEqual(layoutTextLines("短句", 860, 400, halfEm), ["短句"]);
  assert.deepEqual(layoutTextLines("第一行\n第二行", 860, 400, halfEm), [
    "第一行",
    "第二行",
  ]);
});

test("§4.3-2 候选行数上限是 MAX_LINES：窄长视口下 8 行 > 旧上限 3 行", () => {
  const eight = "祝".repeat(8);
  // 1em/字、safeW = SIZE_MIN 下 8 字刚好装满 → 行数越多字号越大
  const lines = layoutTextLines(eight, 128, 4000, em);
  assert.equal(lines.length, MAX_LINES);
  assert.equal(lines.join(""), eight);
  assert.ok(fitsAtMin(lines, 128));
  // 手机竖屏 20 字：候选放宽到 5 行比旧 3 行字号更大（§4.3-2）
  const phone = "祝".repeat(20);
  const five = layoutTextLines(phone, 322, 480, em);
  assert.equal(five.length, 5);
  assert.equal(five.join(""), phone);
  // SIZE_MAX 处行数平局：行数更少的排法胜出（与旧规则一致，不把短句拆成多行）
  assert.deepEqual(layoutTextLines("祝福", 322, 480, em), ["祝福"]);
});

test("§4.3-3 长显式行折行：200 字单行在 SIZE_MIN 下不溢出安全区", () => {
  const long = "字".repeat(200);
  const lines = layoutTextLines(long, 322, 480, em);
  assert.equal(lines.length, 10); // 322 / 16 = 20 字/行
  assert.equal(lines.join(""), long);
  assert.ok(fitsAtMin(lines, 322));
  // 多显式行：硬断行保留（§4.3-1），只有超宽的那条被折
  const mixed = layoutTextLines("短\n" + "字".repeat(60), 322, 480, em);
  assert.equal(mixed[0], "短");
  assert.equal(mixed.length, 4);
  assert.equal(mixed.slice(1).join(""), "字".repeat(60));
  assert.ok(fitsAtMin(mixed, 322));
  // 不超宽的显式行原样保留
  assert.deepEqual(layoutTextLines("你\n好", 322, 480, em), ["你", "好"]);
});

test("§4.1 文字预算 = min(每字素上限 × 码点数, 对应档天花板)", () => {
  assert.equal(PER_GLYPH_BUDGET, 64);
  assert.equal(TEXT_HARD_CAP, 4800);
  assert.equal(textBudget(0, false), 0);
  assert.equal(textBudget(10, false), 10 * PER_GLYPH_BUDGET);
  assert.equal(textBudget(50, false), 3200); // 中间区间：未触顶
  assert.equal(textBudget(75, false), TEXT_HARD_CAP); // 75 字（= 4800 / 64）起触顶
  assert.equal(textBudget(200, false), TEXT_HARD_CAP);
  assert.equal(textBudget(5, true), PER_GLYPH_BUDGET * 5); // 320 < 512：未触顶
  assert.equal(textBudget(9, true), REDUCED_TEXT_HARD_CAP); // 64 × 9 = 576 > 512
  assert.equal(textBudget(200, true), REDUCED_TEXT_HARD_CAP);
  assert.ok(REDUCED_TEXT_HARD_CAP <= 640); // 不给 reduced 档的火花留零头
});

test("§4.2 文字超额不挤死装饰：上限取 max(cap, textCount + DECOR_FLOOR)", () => {
  const cap = 100;
  const world = createWorld(scene(), view, { cap });
  const slots = 400;
  applyTargets(world, gridPoints(20, 20), 12);
  assert.equal(world.targets.length, slots);
  for (let i = 0; i < slots; i++) {
    world.particles.push(
      spark({ x: 10 + i, y: 10, kind: "text", settled: true, life: 1e9 }),
    );
  }
  for (let i = 0; i < 900; i++) {
    world.particles.push(spark({ x: 20 + (i % 700), y: 20, glue: false }));
  }
  step(world, 1 / 60);
  const texts = textParticles(world);
  const decor = world.particles.filter((p) => p.kind !== "text");
  assert.equal(texts.length, slots, "文字零裁剪");
  assert.ok(decor.length >= DECOR_FLOOR, `装饰保底不足：${decor.length}`);
  assert.equal(decor.length, DECOR_FLOOR); // 裁到保底水位，不再往下裁
  assert.equal(world.particles.length, slots + DECOR_FLOOR);
  // 空祝福退化为现状：max(cap, 0 + DECOR_FLOOR)，默认上限下仍是 1800
  const bare = createWorld(scene(), view);
  for (let i = 0; i < 5000; i++) bare.particles.push(spark({ glue: false }));
  step(bare, 1 / 60);
  assert.equal(bare.targets.length, 0);
  assert.equal(bare.particles.length, PARTICLE_CAP);
});

// ---- spec 03 §10.1：方向化 ASCII 文字（DOM 全部注入）----

/** 合成遮罩：`fill` 返回每个像素的 alpha（0..255），s = 1。 */
function maskOf(
  w: number,
  h: number,
  fill: (x: number, y: number) => number,
): Mask {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) alpha[y * w + x] = fill(x, y);
  }
  return { alpha, w, h, s: 1 };
}

const NO_RNG = (): number => 0.25;

/** 角度差（mod 180，0..90）。 */
const angleGap = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

test("§10.1-1 字素不拆：ZWJ emoji、变体选择符、组合附加符", () => {
  assert.ok(hasSegmenter(), "Node ≥22 自带 full-icu，应可直接测分段");
  assert.deepEqual(splitGraphemes("👨‍👩‍👧"), ["👨‍👩‍👧"]);
  assert.deepEqual(splitGraphemes("❤️"), ["❤️"]);
  assert.equal(splitGraphemes("e\u0301").length, 1);
  // 显式 `\n` 先行且原样保留
  const run = segmentText("A👨‍👩‍👧\nB");
  assert.deepEqual(run.segments, ["A👨‍👩‍👧", "B"]);
  assert.deepEqual(run.graphemes[0], ["A", "👨‍👩‍👧"]);
  assert.deepEqual(run.graphemes[1], ["B"]);
});

test("§10.1-2 word 段分类与断点：不在 ASCII 词内断（有词边界可选时）", () => {
  const gs = splitGraphemes("hello 世界");
  assert.deepEqual(gs, ["h", "e", "l", "l", "o", " ", "世", "界"]);
  // 0 = 词/字素边界（空格、CJK 单字、词首尾）；1 = ASCII 词内
  assert.deepEqual(cutRanks("hello 世界", gs), [0, 1, 1, 1, 1, 0, 0, 0, 0]);

  const measure = halfEm;
  // 等分点落在 "abcdefgh" 中间，但空格边界更优（词内惩罚生效）
  assert.deepEqual(layoutTextLines("abcdefgh ijkl", 240, 180, measure), [
    "abcdefgh",
    "ijkl",
  ]);
  // 中英混排：CJK 字素边界与英文词边界同样优先
  assert.deepEqual(cutRanks("世界你好hello", splitGraphemes("世界你好hello")), [
    0, 0, 0, 0, 0, 1, 1, 1, 1, 0,
  ]);
});

test("§10.1-3 Intl.Segmenter 缺失走码点兜底，断点与主路径一致", () => {
  const measure = halfEm;
  const pangram = "The quick brown fox jumps over the lazy dog.";
  assert.deepEqual(
    layoutTextLines(pangram, 860, 400, measure, false),
    layoutTextLines(pangram, 860, 400, measure, true),
  );
  // 显式差异：码点兜底不保字素原子性（emoji 拆成 5 个码点）
  assert.equal(splitGraphemes("👨‍👩‍👧", false).length, 5);
  assert.equal(splitGraphemes("e\u0301", false).length, 2);
});

test("§10.1-5 合成横/竖/斜块 → θ 落在对应 bin（±10°）", () => {
  const W = 12;
  const cases: [string, (x: number, y: number) => number, number][] = [
    ["横", (_x, y) => (y >= 5 && y <= 6 ? 255 : 0), 0],
    ["竖", (x) => (x >= 5 && x <= 6 ? 255 : 0), 90],
    ["反斜 \\", (x, y) => (Math.abs(x - y) <= 1 ? 255 : 0), 45],
    ["正斜 /", (x, y) => (Math.abs(x + y - (W - 1)) <= 1 ? 255 : 0), 135],
  ];
  for (const [name, fill, want] of cases) {
    const m = maskOf(W, W, fill);
    const f = cellFeatures(m.alpha, W, W, 0, 0, W, W);
    assert.ok(angleGap(f.angle, want) <= 10, `${name}: angle=${f.angle}`);
    assert.equal(directionBin(f.angle), directionBin(want), name);
  }
});

test("§10.1-6 十字块 coherence 低；实心块 coverage 高且边缘弱", () => {
  const W = 20;
  const C = 16;
  const cross = maskOf(W, W, (x, y) =>
    Math.abs(x - W / 2) <= 1 || Math.abs(y - W / 2) <= 1 ? 255 : 0,
  );
  const f = cellFeatures(cross.alpha, W, W, 2, 2, C, C);
  assert.ok(f.coherence < COH_MIN, `coherence=${f.coherence}`);

  // 实心块：单元落在实心区内部（边界不在单元内）→ 无梯度、无处不是 ink
  const solid = maskOf(W, W, () => 255);
  const s = cellFeatures(solid.alpha, W, W, 2, 2, C, C);
  assert.ok(s.coverage >= COVER_DENSE, `coverage=${s.coverage}`);
  assert.ok(s.edge < EDGE_MIN, `edge=${s.edge}`);
});

test("§10.1-7 偏心细条重心偏移正确并被钳在 CENTROID_CLAMP 内", () => {
  const W = 20;
  // 中心上方 2px 的细条：重心偏移在钳制范围内，如实反映
  const near = maskOf(W, W, (_x, y) => (y >= 7 && y <= 9 ? 255 : 0));
  const f = cellFeatures(near.alpha, W, W, 0, 0, W, W);
  assert.ok(Math.abs(f.cx) < 1e-9, `cx=${f.cx}`);
  assert.ok(Math.abs(f.cy - -2) < 0.6, `cy=${f.cy}`);
  // 贴顶边的细条：未钳制偏移 -9.5，必须被钳到 ±CENTROID_CLAMP × cell
  const far = maskOf(W, W, (_x, y) => (y <= 1 ? 255 : 0));
  const g = cellFeatures(far.alpha, W, W, 0, 0, W, W);
  assert.equal(g.cy, -CENTROID_CLAMP * W);
  assert.ok(Math.abs(g.cy) < 9.5, "钳制确实生效");
});

test("§10.1-8 空块不产生目标", () => {
  const empty = maskOf(8, 8, () => 0);
  const f = cellFeatures(empty.alpha, 8, 8, 0, 0, 8, 8);
  assert.equal(f.coverage, 0);
  assert.ok(f.coverage < COVER_MIN);
  assert.deepEqual(gridTargets(empty, 8, 8, 0, 0, NO_RNG), []);
});

test("§10.1-9 pickGlyph 决策树四优先级；方向类无随机，内部/点缀走 rng", () => {
  const feat = (patch: Partial<CellFeatures>): CellFeatures => ({
    coverage: 0.2,
    cx: 0,
    cy: 0,
    edge: 0,
    coherence: 1,
    angle: 0,
    ...patch,
  });
  let calls = 0;
  const counting = (v: number) => (): number => {
    calls++;
    return v;
  };
  // 1 内部类：`@` / `*` 类内随机
  assert.equal(pickGlyph(feat({ coverage: COVER_DENSE }), counting(0.9)), "*");
  assert.equal(calls, 1);
  assert.equal(pickGlyph(feat({ coverage: 1 }), counting(0.1)), "@");
  // 2 方向类：四个 bin 且不消耗 rng
  calls = 0;
  assert.equal(pickGlyph(feat({ edge: 1, coherence: 1, angle: 0 }), counting(0)), "-");
  assert.equal(pickGlyph(feat({ edge: 1, coherence: 1, angle: 45 }), counting(0)), "\\");
  assert.equal(pickGlyph(feat({ edge: 1, coherence: 1, angle: 90 }), counting(0)), "|");
  assert.equal(pickGlyph(feat({ edge: 1, coherence: 1, angle: 135 }), counting(0)), "/");
  assert.equal(calls, 0, "方向类必须无随机");
  // 3 交叉/转折类
  assert.equal(
    pickGlyph(feat({ edge: 1, coherence: COH_MIN - 0.01 }), counting(0)),
    "+",
  );
  // 4 点缀类：`.` / `:` 类内随机
  assert.equal(pickGlyph(feat({ edge: EDGE_MIN - 0.01 }), counting(0.9)), ":");
  assert.equal(pickGlyph(feat({ edge: EDGE_MIN - 0.01 }), counting(0.1)), ".");
  // 确定性：同种子 rng 同结果
  assert.equal(
    pickGlyph(feat({ coverage: 1 }), createRng(7)),
    pickGlyph(feat({ coverage: 1 }), createRng(7)),
  );
});

test("§10.1-10 planCellScale：超预算则 k 增大，≤ MAX_ATTEMPTS 内落到预算内", () => {
  const budget = 100;
  const N = 600;
  const seen: number[] = [];
  const plan = planCellScale(budget, (k) => {
    seen.push(k);
    return Math.round(N / (k * k));
  });
  assert.ok(plan.k > 1, `k=${plan.k}`);
  assert.ok(plan.k <= K_MAX);
  assert.ok(plan.n <= budget, `n=${plan.n}`);
  assert.ok(seen.length <= MAX_ATTEMPTS, `attempts=${seen.length}`);
  assert.deepEqual(planCellScale(5000, () => 10), { k: 1, attempts: 1, n: 10 });

  // 输出为连续扫描序（无 stride 缺口）：y 外层、x 内层，逐格相邻
  const grid = maskOf(24, 24, () => 255);
  const pts = gridTargets(grid, 12, 12, 0, 0, NO_RNG);
  assert.deepEqual(
    pts.map((p) => [p.x, p.y]),
    [
      [6, 6],
      [18, 6],
      [6, 18],
      [18, 18],
    ],
  );
});

test("§10.1-11 字号几何：advance(cellH) ≤ cellW（固定 ratio 注入）", () => {
  for (const ratio of [0.5, 0.6, 0.75]) {
    for (const cellW of [7, 8, 13, 20, 50]) {
      const { cellH } = cellMetrics(cellW, 1, ratio);
      assert.ok(
        ratio * cellH <= cellW,
        `ratio=${ratio} cellW=${cellW} advance=${ratio * cellH}`,
      );
      assert.ok(cellW - ratio * cellH < 1, `取整误差应 <1px`);
    }
  }
  const exact = cellMetrics(12, 1, 0.6);
  assert.deepEqual(exact, { cellW: 12, cellH: 20 });
  assert.equal(0.6 * exact.cellH, exact.cellW);
});

test("§10.1-12 applyTargets 透传 GlyphTarget.glyph；旧 Point[] 注入兼容", () => {
  const world = createWorld(scene({ message: "祝福" }), view);
  applyTargets(
    world,
    [
      { x: 100, y: 100 },
      { x: 200, y: 200, glyph: "|" },
    ],
    12,
  );
  assert.equal(world.targets.length, 2);
  assert.equal(world.targets[0]?.glyph, undefined);
  assert.equal(world.targets[1]?.glyph, "|");
  assert.equal(world.step, 12);
});

test("§10.1-13 四个绑定点换形：捕获/收尾两路/低动就地形同步 slot.glyph", () => {
  // 捕获（含低动态就地形：位置第一帧起在目标上，字形同样定型）
  for (const reducedMotion of [false, true]) {
    const world = createWorld(scene(), view, { reducedMotion });
    applyTargets(world, [{ x: 400, y: 300, glyph: "/" }], 12);
    const p = spark({ x: 400, y: 280, vy: 90, glyph: "@" });
    world.particles.push(p);
    assert.ok(stepUntil(world, () => p.kind === "text"), "应发生接触捕获");
    assert.equal(p.glyph, "/");
    assert.ok(stepUntil(world, () => p.settled === true, 2));
    assert.equal(p.glyph, "/");
  }
  // 收尾飞行（bloom，含低动态就地淡入分支）
  for (const reducedMotion of [false, true]) {
    const world = createWorld(scene(), view, { reducedMotion });
    applyTargets(world, [{ x: 400, y: 300, glyph: "-" }], 12);
    startFinale(world);
    assert.ok(stepUntil(world, () => textParticles(world).length === 1, 1));
    assert.equal(textParticles(world)[0]?.glyph, "-");
  }
  // 完成态重排（fillFree）就地补齐
  const settled = createWorld(scene({ message: "祝福" }), view);
  settled.phase = "settled";
  applyTargets(settled, [{ x: 100, y: 100, glyph: "*" }], 12);
  assert.equal(textParticles(settled)[0]?.glyph, "*");
});

test("§10.1-14 视口迁移成功槽位同步占据者字形；失败释放路径不变", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(4, 6), 12);
  // 让部分槽位落定，再迁移到附近并换字形
  const sticky = [0, 5, 10];
  for (const i of sticky) {
    const t = world.targets[i];
    if (t) world.particles.push(spark({ x: t.x, y: t.y - 30, vy: 120 }));
  }
  assert.ok(stepUntil(world, () => world.stuck === sticky.length, 3));
  for (const i of sticky) {
    const t = world.targets[i];
    if (t) t.glyph = "|";
  }
  const moved = gridPoints(4, 6).map((p) => ({ ...p, glyph: "+" }));
  applyTargets(world, moved, 12);
  assert.equal(world.stuck, 3, "只改字形不改位置，不应释放");
  const holders = world.targets.filter((t) => t.state === "stuck").map((t) => t.holder);
  assert.ok(holders.every((h) => h?.glyph === "+"));
});

test("§10.1-15 托底：在文字粒子之前、alpha 随 settleT 渐入、低动直接全量", () => {
  const layout = {
    lines: ["祝福"],
    size: 80,
    lineHeight: 108,
    cellW: 20,
    cellH: 24,
    scale: 1,
  };
  const draws: { text: string; font: string; alpha: number }[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    globalAlpha: 1,
    textAlign: "center",
    textBaseline: "middle",
    setTransform() {},
    clearRect() {},
    fillText(text: string) {
      draws.push({ text, font: ctx.font, alpha: ctx.globalAlpha });
    },
  } as unknown as CanvasRenderingContext2D;
  const mkWorld = (reducedMotion: boolean): World => {
    const world = createWorld(scene({ message: "祝福" }), view, { reducedMotion });
    world.phase = "settled";
    world.textLayout = layout;
    world.textSize = 24;
    world.particles.push({
      ...spark({ x: 400, y: 300, glyph: "@", kind: "text" }),
      settled: true,
    });
    return world;
  };

  // 常动态：settleT=0 时不画托底，只有文字粒子
  const fresh = mkWorld(false);
  render(ctx, fresh);
  assert.deepEqual(draws.map((d) => d.text), ["@"]);
  // 渐入未完成：alpha < BACKDROP_ALPHA 且托底在文字粒子之前
  draws.length = 0;
  fresh.settleT = BACKDROP_FADE / 2;
  render(ctx, fresh);
  assert.deepEqual(draws.map((d) => d.text), ["祝福", "@"]);
  assert.ok((draws[0]?.alpha ?? 0) > 0 && (draws[0]?.alpha ?? 0) < BACKDROP_ALPHA);
  assert.match(draws[0]?.font ?? "", /700 80px/);
  assert.match(draws[1]?.font ?? "", /^24px/);
  // 封顶 BACKDROP_ALPHA
  draws.length = 0;
  fresh.settleT = BACKDROP_FADE;
  render(ctx, fresh);
  assert.equal(draws[0]?.alpha, BACKDROP_ALPHA);
  // 低动态：直接全量
  draws.length = 0;
  render(ctx, mkWorld(true));
  assert.deepEqual(
    draws.map(({ text, alpha }) => ({ text, alpha })),
    [
      { text: "祝福", alpha: BACKDROP_ALPHA },
      { text: "@", alpha: 1 },
    ],
  );
});

test("§4.8-1 DOM 装配冒烟：stub canvas 跑通分段→遮罩→网格→目标", () => {
  // 只验证 DOM 胶水能跑到底并写出几何契约；逐字素像素由 M11 纯函数测。
  // stub 把“墨迹”模拟成以 `fillText` 锚点为中心的一条横带 → 可验证遮罩锚点与托底同源。
  type Draw = {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    align: string;
    baseline: string;
  };
  const draws: Draw[] = [];
  let ink: { from: number; to: number } | null = null;
  const makeCanvas = (): {
    width: number;
    height: number;
    getContext: () => CanvasRenderingContext2D;
  } => {
    let ctx: CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      // 同一个 canvas 必须复用同一个 ctx（代码会多次 getContext，状态要一致）
      getContext: (): CanvasRenderingContext2D => ctx,
    };
    ctx = {
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      measureText: (text: string) => ({
        width: Array.from(text).length * 32,
        fontBoundingBoxAscent: 32,
        fontBoundingBoxDescent: 8,
      }),
      fillText: (text: string, x: number, y: number) => {
        const fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 0);
        ink = { from: y - 0.1 * fontPx, to: y + 0.1 * fontPx };
        draws.push({
          text,
          x,
          y,
          w: canvas.width,
          h: canvas.height,
          align: ctx.textAlign,
          baseline: ctx.textBaseline,
        });
      },
      getImageData: (_x: number, _y: number, cw: number, ch: number) => {
        const data = new Uint8ClampedArray(cw * ch * 4);
        if (ink) {
          for (
            let y = Math.max(0, Math.ceil(ink.from));
            y <= Math.min(ch - 1, ink.to);
            y++
          ) {
            for (let x = 0; x < cw; x++) data[(y * cw + x) * 4 + 3] = 255;
          }
        }
        return { data } as ImageData;
      },
    } as unknown as CanvasRenderingContext2D;
    return canvas;
  };
  const original = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => makeCanvas(),
  };
  try {
    const world = createWorld(scene({ message: "祝福" }), view);
    refreshTargets(world);
    const layout = world.textLayout;
    assert.ok(layout, "应写入排版结果");
    assert.ok(world.targets.length > 0, "有墨迹应产生目标");
    assert.equal(world.step, layout.cellH);
    assert.equal(world.textSize, layout.cellH);
    // spec 03 §3 栅格（2026-09 产品决策 CELL_MAX 12→10 / CELL_MIN 7→6）：
    // 大字号被 CELL_MAX 钳住，小字号（200 字折行 → size = SIZE_MIN）被 CELL_MIN 钳住
    assert.equal(layout.cellW, CELL_MAX);
    const small = createWorld(scene({ message: "字".repeat(200) }), view);
    refreshTargets(small);
    assert.equal(small.textLayout?.cellW, CELL_MIN);
    assert.ok(world.targets.every((t) => typeof t.glyph === "string"));
    assert.ok(
      world.targets.every((t) => t.x >= 0 && t.x <= view.w && t.y >= 0 && t.y <= view.h),
    );

    // 遮罩与托底同源（spec 03 §5-3）：同一 align/baseline，锚点就在遮罩盒中心 →
    // 遮罩居中即锚点落在视口中心，与 render 的托底重合
    const maskDraw = draws.find((d) => d.text === "祝福");
    assert.ok(maskDraw, "遮罩应绘制祝福文字");
    assert.equal(maskDraw.align, "center");
    assert.equal(maskDraw.baseline, "middle");
    assert.equal(maskDraw.x, maskDraw.w / 2, "锚点必须在遮罩盒水平中心");
    assert.equal(maskDraw.y, maskDraw.h / 2, "锚点必须在遮罩盒垂直中心");
    // 墨迹带（围绕锚点）经采样后的目标重心应在视口中心附近（误差 ≤ 一个单元）
    const cx = world.targets.reduce((s, t) => s + t.x, 0) / world.targets.length;
    const cy = world.targets.reduce((s, t) => s + t.y, 0) / world.targets.length;
    assert.ok(Math.abs(cx - view.w / 2) <= layout.cellW, `cx=${cx}`);
    assert.ok(Math.abs(cy - view.h / 2) <= layout.cellH, `cy=${cy}`);

    // 扫描序连续：y 不降，同行 x 递增
    for (let i = 1; i < world.targets.length; i++) {
      const a = world.targets[i - 1];
      const b = world.targets[i];
      if (!a || !b) continue;
      assert.ok(b.y >= a.y && (b.y > a.y || b.x > a.x));
    }
    // 空祝福：清空目标与排版（§4.8-1）
    world.scene = { ...world.scene, message: "" };
    refreshTargets(world);
    assert.equal(world.textLayout, null);
    assert.equal(world.targets.length, 0);
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
});

test("爆炸火花数：单次爆炸 ≥ BLAST_SPARKS_BASE，低动态 × 0.4；双壳层含填满环心的内核盘", () => {
  for (const reducedMotion of [false, true]) {
    const world = createWorld(scene(), view, { reducedMotion });
    launch(world, 400);
    assert.ok(stepUntil(world, () => world.blasts === 1, 4), "应发生爆炸");
    const sparks = world.particles.filter(
      (p) => p.kind === "spark" || p.kind === "ember",
    );
    const want = Math.floor(BLAST_SPARKS_BASE * (reducedMotion ? 0.4 : 1));
    assert.ok(sparks.length >= want, `${sparks.length} < ${want}`);
    // 外层速率 ≥ SPARK_SPEED_MIN，内核铺在 [0.1, 0.9] × SPARK_SPEED_MIN（ember 自降速到 0.5×，
    // 故只统计 kind === 'spark'）
    const speeds = world.particles
      .filter((p) => p.kind === "spark")
      .map((p) => Math.hypot(p.vx, p.vy));
    assert.ok(Math.min(...speeds) < 70, `无慢速内核：${Math.min(...speeds)}`);
    assert.ok(Math.max(...speeds) >= 100, `无外层：${Math.max(...speeds)}`);
    // 内核不是单一速率：单速会让全部内核粒子落在同一半径上 → 空心圈
    // （review/04 §4「双壳层观感」的 2026-09 修正）
    const core = speeds.filter((s) => s < SPARK_SPEED_MIN);
    assert.ok(core.length > 20, `内核粒子太少：${core.length}`);
    assert.ok(
      Math.min(...core) <= SPARK_SPEED_MIN * 0.3,
      `内核未铺到近静止：${Math.min(...core)}`,
    );
    assert.ok(
      Math.max(...core) >= SPARK_SPEED_MIN * 0.7,
      `内核未铺到外层下限：${Math.max(...core)}`,
    );
    const bands = new Set(core.map((s) => Math.floor(s / 20)));
    assert.ok(
      bands.size >= 4,
      `内核速率只有 ${bands.size} 档：${[...bands].join(",")}`,
    );
  }
});

test("createRng 同种子可复现、异种子不同、取值在 [0,1)", () => {
  const a = createRng(240520);
  const b = createRng(240520);
  const c = createRng(240521);
  const seq = Array.from({ length: 16 }, () => a());
  assert.deepEqual(
    seq,
    Array.from({ length: 16 }, () => b()),
  );
  assert.notDeepEqual(
    seq,
    Array.from({ length: 16 }, () => c()),
  );
  for (const v of seq) assert.ok(v >= 0 && v < 1, String(v));
});

test("七枚火箭全部飞到顶点并爆炸", () => {
  const world = createWorld(scene(), view);
  for (let i = 0; i < 7; i++) launch(world, 100 + i * 90);
  assert.equal(world.blasts, 0); // 计数发生在爆炸时，不是发射时
  assert.equal(world.playerBlasts, 0);
  step(world, 3);
  assert.equal(world.blasts, 7);
  assert.equal(world.playerBlasts, 7); // 玩家发射的爆炸同时计入轮数
  assert.ok(world.particles.length > 0);
});

test("默认上限 1800，reduced motion 为 640", () => {
  assert.equal(PARTICLE_CAP, 1800);
  assert.equal(createWorld(scene(), view).cap, 1800);
  assert.equal(createWorld(scene(), view, { reducedMotion: true }).cap, 640);
});

test("§8.1-1 applyTargets 初始化槽位、身份顺序与计数", () => {
  const world = createWorld(scene(), view);
  const points = gridPoints(5, 8);
  applyTargets(world, points, 12);
  assert.equal(world.targets.length, 40);
  assert.equal(world.stuck, 0);
  assert.equal(world.reserved, 0);
  assert.equal(world.step, 12);
  assert.equal(world.captureR, 12 * 1.2); // clamp(step * 1.2, 8, 24)
  assert.deepEqual(
    world.targets.map((t) => t.order),
    [...Array(40).keys()],
  );
  assert.deepEqual(
    world.targets.map((t) => [t.x, t.y]),
    points.map((p) => [p.x, p.y]),
  );
  assert.ok(
    world.targets.every((t) => t.state === "free" && t.holder === null),
  );
  // 空间桶覆盖每个目标，且只存下标
  assert.ok(world.grid.size > 0);
  let bucketed = 0;
  for (const bucket of world.grid.values()) bucketed += bucket.length;
  assert.equal(bucketed, 40);
  const { x0, y0, x1, y1 } = world.bounds;
  assert.equal(x0, 50);
  assert.equal(y0, 60);
  assert.equal(x1, 750);
  assert.equal(y1, 540);
});

test("§8.1-2 局部捕获与唯一占据：相邻目标只被占据一个", () => {
  const world = createWorld(scene(), view);
  applyTargets(
    world,
    [
      { x: 400, y: 300 },
      { x: 400, y: 324 },
    ],
    12,
  );
  const p = spark({ x: 400, y: 120, vy: 180 });
  world.particles.push(p);
  assert.ok(
    stepUntil(world, () => p.kind === "text"),
    "应发生接触捕获",
  );
  assert.equal(world.reserved + world.stuck, 1);
  assert.equal(world.targets.filter((t) => t.state !== "free").length, 1);
  assert.equal(world.targets.find((t) => t.state !== "free")?.holder, p);
  assert.equal(p.targetId, 0); // 先经过的那个（order 小）
});

test("§8.1-3 接触半径硬边界：远处火花永不捕获", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, [{ x: 400, y: 300 }], 12);
  const p = spark({ x: 200, y: 300, vy: 60 }); // 横向相差 200px ≫ captureR
  world.particles.push(p);
  step(world, 3);
  assert.equal(p.kind, "spark");
  assert.equal(world.reserved + world.stuck, 0);
  assert.equal(world.targets[0]?.state, "free");
});

test("§8.1-4 捕获后 STICK_TIME 内落定，位置到位、字形与来源色保留", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, [{ x: 400, y: 300 }], 12);
  const p = spark({ x: 400, y: 280, vy: 90, color: "#123456", glyph: "@" });
  world.particles.push(p);
  assert.ok(
    stepUntil(world, () => p.kind === "text"),
    "应发生接触捕获",
  );
  assert.equal(p.targetId, 0);
  assert.notEqual(p.settled, true); // 还在减速过渡里
  assert.equal(typeof p.stickT, "number");
  assert.ok(p.life > 1e6, "文字粒子不再参与寿命淘汰");
  step(world, STICK_TIME + 0.02);
  assert.equal(p.settled, true);
  assert.equal(p.x, 400);
  assert.equal(p.y, 300);
  assert.equal(p.color, "#123456");
  assert.equal(p.glyph, "@");
  assert.equal(world.stuck, 1);
  assert.equal(world.reserved, 0);
  assert.equal(world.phase, "settled"); // 唯一目标落定 = 完成
});

test("§8.1-5 重复命中不改变已落定的粘点", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, [{ x: 400, y: 300 }], 12);
  const p = spark({ x: 400, y: 280, vy: 90, color: "#123456", glyph: "@" });
  world.particles.push(p);
  assert.ok(stepUntil(world, () => p.settled === true));
  for (let i = 0; i < 30; i++) {
    world.particles.push(spark({ x: 398, y: 288, vy: 60 }));
  }
  step(world, 1.5);
  assert.equal(p.x, 400);
  assert.equal(p.y, 300);
  assert.equal(p.color, "#123456");
  assert.equal(p.glyph, "@");
  assert.equal(world.targets[0]?.holder, p);
  assert.equal(world.stuck, 1);
  assert.equal(world.reserved, 0);
  assert.equal(textParticles(world).length, 1);
});

test("§8.1-6 粘点持久性：连点与上限压力下只增不减", () => {
  const world = createWorld(scene(), view, { cap: 200 });
  applyTargets(world, gridPoints(6, 10), 12);
  let prev = 0;
  for (let i = 0; i < 20; i++) {
    launch(world, 100 + (i % 4) * 180, 120 + (i % 3) * 150);
    step(world, 1);
    assert.ok(
      world.stuck >= prev,
      `第 ${i}s 粘点减少：${world.stuck} < ${prev}`,
    );
    prev = world.stuck;
    assert.ok(textParticles(world).length <= world.targets.length);
  }
  assert.ok(prev > 0, "20s 连点应至少留下一个粘点");
});

test("§8.1-13 预算保护：文字粒子不参与上限裁剪，且装饰有保底额度", () => {
  const cap = 200;
  const world = createWorld(scene(), view, { cap });
  applyTargets(world, gridPoints(6, 10), 12);
  for (let i = 0; i < 12; i++) launch(world, 40 + i * 60);
  step(world, 3);
  const rockets = world.particles.filter((p) => p.kind === "rocket").length;
  const nonRocket = world.particles.filter((p) => p.kind !== "rocket");
  // spec 04 §4.2：上限 = max(cap, textCount + DECOR_FLOOR)，文字超额也要给装饰留活口
  const limit = Math.max(cap, world.targets.length + DECOR_FLOOR);
  assert.ok(nonRocket.length <= limit, `${nonRocket.length} > ${limit}`);
  assert.ok(world.particles.length <= limit + rockets);
  const texts = textParticles(world);
  assert.ok(texts.length > 0, "应留下粘点或在途粒子");
  assert.ok(texts.every((p) => p.life > 1e6));
  assert.equal(world.stuck + world.reserved, texts.length);
});

test("§8.1-17 空祝福不越界：没有目标就没有粘附、收尾与完成", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, [], 0);
  assert.equal(world.targets.length, 0);
  startFinale(world); // no-op
  assert.equal(world.phase, "playing");
  assert.equal(world.queue.length, 0);
  for (let i = 0; i < 10; i++) launch(world, 80 + i * 60);
  step(world, 4);
  assert.equal(world.playerBlasts, 10);
  assert.equal(world.stuck, 0);
  assert.equal(world.phase, "playing");
  assert.equal(textParticles(world).length, 0);
});

test("§8.1-7 十轮自动触发收尾（提前入口之外的另一条路径）", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(6, 10), 12);
  for (let i = 0; i < 10; i++) launch(world, 80 + i * 60);
  assert.ok(
    stepUntil(world, () => world.phase === "revealing", 6),
    "第十轮爆炸后应开始收尾",
  );
});

test("§8.1-7 玩家轮数与自动烟花计数分离", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(6, 10), 12);
  launch(world, 400);
  step(world, 2);
  assert.equal(world.blasts, 1);
  assert.equal(world.playerBlasts, 1);

  startFinale(world);
  const before = world.blasts;
  step(world, 0.5);
  assert.ok(world.blasts > before, "收尾小烟花计入总爆炸数（供音效）");
  assert.equal(world.playerBlasts, 1, "自动烟花不计轮数");
});

test("§8.1-8 触发幂等：重复 startFinale 不重排、不重复绽放", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(4, 5), 12);
  startFinale(world);
  assert.equal(world.phase, "revealing");
  const queued = world.queue.length;
  assert.ok(queued > 0);
  startFinale(world);
  assert.equal(world.queue.length, queued);
  assert.equal(world.finaleT, 0);

  step(world, 0.6);
  const inFlight = textParticles(world).length;
  assert.ok(inFlight > 0);
  startFinale(world);
  assert.equal(world.phase, "revealing");
  assert.equal(textParticles(world).length, inFlight);
});

test("§8.1-9 零轮提前收尾：120 个目标 6s 内补齐", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(10, 12), 12);
  assert.equal(world.targets.length, 120);
  startFinale(world);
  step(world, 6);
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, 120);
  assert.equal(world.queue.length, 0);
});

test("单点缺口也从附近小烟花飞入，不在终点凭空生成", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, [{ x: 400, y: 300 }], 12);
  startFinale(world);
  assert.ok(stepUntil(world, () => textParticles(world).length === 1, 1));
  const p = textParticles(world)[0];
  assert.ok(p);
  assert.ok(p.fx !== undefined && p.fy !== undefined);
  assert.ok(Math.hypot(p.fx - 400, p.fy - 300) > 0);
  assert.ok(stepUntil(world, () => world.phase === "settled", 2));
});

test("超过12批的收尾仍在四秒内完成", () => {
  const wide = { w: 8_000, h: 600, dpr: 1 };
  const world = createWorld(scene(), wide);
  const points = Array.from({ length: 26 }, (_, i) => ({
    x: 100 + i * 300,
    y: 300,
  }));
  applyTargets(world, points, 12);
  startFinale(world);
  assert.ok(
    world.queue.length > 12,
    `只有 ${world.queue.length} 批，未覆盖回归场景`,
  );
  step(world, 4);
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, points.length);
});

test("§8.1-10 最差落点：有限补齐、飞行距离有界、不瞬移", () => {
  const world = createWorld(scene(), view);
  // 240 个目标全挤在角落：补齐必须从远处飞过来
  const corner: Point[] = [];
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 20; c++) corner.push({ x: 40 + c * 6, y: 40 + r * 6 });
  }
  applyTargets(world, corner, 12);
  assert.equal(world.targets.length, 240);
  startFinale(world);

  const dt = 1 / 60;
  const starts = new Map<
    Particle,
    { fx: number; fy: number; tx: number; ty: number }
  >();
  let maxSpeed = 0;
  for (let t = 0; t < 6; t += dt) {
    const before = new Map<Particle, [number, number]>();
    for (const p of textParticles(world)) before.set(p, [p.x, p.y]);
    update(world, dt);
    for (const p of textParticles(world)) {
      if (!starts.has(p)) {
        const target =
          p.targetId === undefined ? undefined : world.targets[p.targetId];
        if (p.fx !== undefined && p.fy !== undefined && target) {
          starts.set(p, { fx: p.fx, fy: p.fy, tx: target.x, ty: target.y });
        }
      }
      const was = before.get(p);
      if (!was) continue; // 本帧新建：从下一帧开始测速
      maxSpeed = Math.max(
        maxSpeed,
        Math.hypot(p.x - was[0], p.y - was[1]) / dt,
      );
    }
  }
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, 240);
  assert.equal(starts.size, 240);
  assert.ok(maxSpeed <= 900, `峰值位移速度 ${maxSpeed}px/s`);
  for (const s of starts.values()) {
    const d = Math.hypot(s.tx - s.fx, s.ty - s.fy);
    assert.ok(d > 0, "补字粒子的起点不等于终点（无瞬移）");
    assert.ok(d <= MAX_FLIGHT, `飞行距离 ${d} > ${MAX_FLIGHT}`);
  }
});

test("§8.1-11 收尾期持续输入不阻塞补齐", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(8, 10), 12);
  startFinale(world);
  const dt = 1 / 60;
  let prev = world.stuck;
  let nextLaunch = 0;
  for (let t = 0; t < 6; t += dt) {
    update(world, dt);
    assert.ok(world.stuck >= prev, `粘点减少：${world.stuck} < ${prev}`);
    prev = world.stuck;
    if (t >= nextLaunch) {
      launch(world, 100 + ((t * 120) % 600));
      nextLaunch += 0.2;
    }
  }
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, world.targets.length);
  assert.equal(world.queue.length, 0);
});

test("§8.1-12 自然提前补齐：playing 内直接 settled", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(2, 3), 12);
  for (const t of world.targets) {
    world.particles.push(spark({ x: t.x, y: t.y - 30, vy: 120 }));
  }
  assert.ok(stepUntil(world, () => world.phase === "settled", 5));
  assert.equal(world.stuck, 6);
  assert.equal(world.finaleT, 0); // 没有经过 revealing
  assert.equal(world.queue.length, 0);
});

test("§8.1-18 颜色统一与呼吸", () => {
  assert.equal(mixHex("#ffffff", "#000000", 0.5), "rgb(128, 128, 128)");
  assert.equal(mixHex("#ff0000", "#0000ff", 0), "rgb(255, 0, 0)");
  assert.equal(mixHex("#ff0000", "#0000ff", 1), "rgb(0, 0, 255)");

  const world = createWorld(scene(), view);
  applyTargets(world, [{ x: 400, y: 300 }], 12);
  const p = spark({ x: 400, y: 280, vy: 90, color: "#123456" });
  world.particles.push(p);
  assert.ok(stepUntil(world, () => p.settled === true));
  assert.equal(world.phase, "settled");
  assert.equal(textColor(world, p.color), "#123456"); // settleT = 0：仍是来源色
  step(world, 0.85); // > COLOR_FADE
  assert.equal(textColor(world, p.color), world.palette.glow);

  // 呼吸只改 alpha：时钟推进一整段后位置完全不变
  const pos = world.targets.map((t) => [t.holder?.x, t.holder?.y]);
  step(world, 10);
  assert.deepEqual(
    world.targets.map((t) => [t.holder?.x, t.holder?.y]),
    pos,
  );
});

test("§8.1-14 重置取消旧任务，之后仍能完成", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(6, 10), 12);
  startFinale(world);
  step(world, 0.6);
  assert.equal(world.phase, "revealing");

  resetScene(world);
  assert.equal(world.phase, "playing");
  assert.equal(world.queue.length, 0);
  assert.deepEqual(
    [
      world.blasts,
      world.playerBlasts,
      world.stuck,
      world.reserved,
      world.settleT,
      world.finaleT,
      world.batchTimer,
    ],
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.ok(
    world.targets.every((t) => t.state === "free" && t.holder === null),
  );

  startFinale(world);
  step(world, 6);
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, world.targets.length);
});

test("§8.1-15 视口迁移：不提前完成、不清空，粘点落到新坐标", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(4, 6), 12);
  const sticky = [0, 5, 10, 15];
  for (const i of sticky) {
    const t = world.targets[i];
    if (t) world.particles.push(spark({ x: t.x, y: t.y - 30, vy: 120 }));
  }
  assert.ok(stepUntil(world, () => world.stuck === sticky.length, 3));

  setViewport(world, { w: 900, h: 540, dpr: 2 });
  // 旧目标先归一化到新视口；一列再故意移出容差，其余只偏移 8px。
  const moved = gridPoints(4, 6).map((p, i) => {
    const scaled = { x: p.x * (900 / 800), y: p.y * (540 / 600) };
    return i % 6 === 5
      ? { x: scaled.x - 200, y: scaled.y }
      : { x: scaled.x + 8, y: scaled.y };
  });
  applyTargets(world, moved, 12);

  assert.equal(world.phase, "playing", "迁移不提前完成");
  assert.equal(world.stuck, 3); // 只有一个被释放
  for (const t of world.targets) {
    if (t.state !== "stuck") continue;
    const h = t.holder;
    assert.ok(h, "stuck 槽位必须有占据者");
    assert.equal(h.x, t.x);
    assert.equal(h.y, t.y);
  }
  assert.equal(world.stuck + world.reserved, textParticles(world).length);
  const released = world.particles.filter(
    (p) => p.kind === "spark" && p.maxLife === 0.4,
  );
  assert.equal(released.length, 1); // 被释放的粒子退回有寿命的装饰粒子
  assert.equal(released[0]?.targetId, undefined);
});

test("§8.1-16 完成态重排后仍完整", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(4, 6), 12);
  startFinale(world);
  step(world, 6);
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, world.targets.length);

  // 更密的点集（等价于完成态下的重新采样）
  const dense: Point[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 10; c++) dense.push({ x: 60 + c * 70, y: 60 + r * 60 });
  }
  applyTargets(world, dense, 12);
  assert.equal(world.stuck, dense.length);
  for (const t of world.targets) {
    assert.equal(t.state, "stuck");
    assert.equal(t.holder?.x, t.x);
  }
  step(world, 1 / 60);
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, world.targets.length);
});

test("预留安全网：失效的预留被释放并重排，缺口仍能补齐", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, gridPoints(2, 3), 12);
  startFinale(world);
  // 人为制造一个超过 RESERVE_TTL 仍未落定的预留
  const t = world.targets[0];
  assert.ok(t);
  const ghost = spark({
    x: t.x,
    y: t.y - 5,
    kind: "text",
    life: 1e9,
    maxLife: 1e9,
    targetId: 0,
    fx: 0,
    fy: 0,
    flightT: 4,
    flightDur: 1e9,
  });
  t.state = "reserved";
  t.holder = ghost;
  world.reserved++;
  world.particles.push(ghost);

  step(world, 1 / 60);
  assert.equal(t.state, "free");
  assert.equal(t.holder, null);
  assert.equal(world.reserved, 0);
  assert.equal(ghost.kind, "spark");
  assert.equal(ghost.targetId, undefined);
  assert.ok(ghost.life <= 0.4, "释放后退回有寿命的装饰粒子");

  step(world, 6);
  assert.equal(world.phase, "settled");
  assert.equal(world.stuck, world.targets.length);
});

test("resetScene 清空粒子、计数、时钟与占据，并按种子重置 RNG", () => {
  const world = createWorld(scene(), view);
  applyTargets(world, [{ x: 400, y: 300 }], 12);
  launch(world, 400);
  step(world, 3);
  assert.ok(world.blasts > 0);
  assert.ok(world.particles.length > 0);

  resetScene(world);
  assert.equal(world.particles.length, 0);
  assert.equal(world.blasts, 0);
  assert.equal(world.playerBlasts, 0);
  assert.equal(world.stuck, 0);
  assert.equal(world.reserved, 0);
  assert.equal(world.clock, 0);
  assert.equal(world.finaleT, 0);
  assert.equal(world.settleT, 0);
  assert.equal(world.queue.length, 0);
  assert.equal(world.phase, "playing");
  assert.ok(
    world.targets.every((t) => t.state === "free" && t.holder === null),
    "重播保留目标点但清空占据",
  );
  // 重播 = 从种子重新开始：重置后的第一个随机数与种子序列一致
  assert.equal(world.rng(), createRng(world.scene.seed)());
});
