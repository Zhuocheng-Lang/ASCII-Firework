import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCENE } from "./scene.ts";
import type { SceneConfig } from "./scene.ts";
import {
  MAX_FLIGHT,
  PARTICLE_CAP,
  STICK_TIME,
  applyTargets,
  createRng,
  createWorld,
  launch,
  layoutTextLines,
  mixHex,
  render,
  resetScene,
  setViewport,
  startFinale,
  textColor,
  update,
} from "./fireworks.ts";
import type { Particle, Point, World } from "./fireworks.ts";

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

test("spec 03 单行长文案自动换行，短句与显式换行保持原样", () => {
  const measure = (text: string): number => Array.from(text).length * 50;
  assert.deepEqual(
    layoutTextLines(
      "The quick brown fox jumps over the lazy dog.",
      860,
      400,
      measure,
    ),
    ["The quick brown", "fox jumps over", "the lazy dog."],
  );
  assert.deepEqual(layoutTextLines("短句", 860, 400, measure), ["短句"]);
  assert.deepEqual(layoutTextLines("第一行\n第二行", 860, 400, measure), [
    "第一行",
    "第二行",
  ]);
});

test("低动态完成态先画等大半透明底字，再画放大的 ASCII", () => {
  const world = createWorld(scene({ message: "祝福" }), view, {
    reducedMotion: true,
  });
  world.phase = "settled";
  world.textFontSize = 80;
  world.textLines = ["祝福"];
  world.textSize = 20;
  world.particles.push({
    ...spark({ x: 400, y: 300, glyph: "@", kind: "text" }),
    settled: true,
  });

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

  render(ctx, world);
  assert.deepEqual(
    draws.map(({ text, alpha }) => ({ text, alpha })),
    [
      { text: "祝福", alpha: 0.2 },
      { text: "@", alpha: 1 },
    ],
  );
  assert.match(draws[0]?.font ?? "", /700 80px/);
  assert.match(draws[1]?.font ?? "", /^20px/);
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

test("默认上限 1200，reduced motion 为 420", () => {
  assert.equal(PARTICLE_CAP, 1200);
  assert.equal(createWorld(scene(), view).cap, 1200);
  assert.equal(createWorld(scene(), view, { reducedMotion: true }).cap, 420);
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

test("§8.1-13 预算保护：文字粒子不参与上限裁剪", () => {
  const cap = 200;
  const world = createWorld(scene(), view, { cap });
  applyTargets(world, gridPoints(6, 10), 12);
  for (let i = 0; i < 12; i++) launch(world, 40 + i * 60);
  step(world, 3);
  const rockets = world.particles.filter((p) => p.kind === "rocket").length;
  const nonRocket = world.particles.filter((p) => p.kind !== "rocket");
  assert.ok(nonRocket.length <= cap, `${nonRocket.length} > ${cap}`);
  assert.ok(world.particles.length <= cap + rockets);
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
