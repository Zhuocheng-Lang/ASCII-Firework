# ASCII Firework 实现规格：粘附显字（Spec v2）

> 状态：已实施并通过自动化核验；浏览器观感、真机性能与视觉调参仍待完成。实施与复核记录见 `../review/02-sticky-text-reveal-acceptance.md`。
> 权威设计：`.agents/design/02-sticky-text-reveal.md`（下称"设计 02"，冲突时以它为准）。其余产品与技术边界沿用 `.agents/design/01-product-and-architecture.md` 与 `.agents/spec/01-ascii-firework-v1.md`（下称"spec 01"）。
> 本文只回答 **怎么做、怎么验**，不再讨论做什么，也不重复设计 02 已确认的 12 项体验决策。
> 约定：**MUST** 强制 / **SHOULD** 建议 / **MAY** 可选。所有时长、半径、比例都是**未验证基线**，必须经人工视觉验证后回写。

## 1. 范围与文档关系

覆盖：把"第七次爆炸后统一回流成字"替换为"火花粘附积累 + 第十轮自动收尾 + 完成统一颜色"的全部运行时改动、数据契约、测试与验收。

不在范围：URL 格式与版本、部署架构、字体资产、音频图实现、分享流程、`PRNG`、`dpr` 规则、DPR/画布尺寸策略、无第三方请求的约束。这些保持现状，spec 01 继续有效。

| spec 01 条目 | 本文的处理 |
| --- | --- |
| §7.6 揭示算法（时间线、硬截止、配对补点） | **被 §4 取代**；`REVEAL_DONE` / `REVEAL_DEADLINE` / `pairTargets` / 弹簧时间线全部删除 |
| §7.7 视口变化、重播与外部导航（揭示期立即吸附） | **被 §4.9 取代**：视口变化只迁移，不提前完成 |
| §8.1 状态转换（`REVEAL_AFTER = 7`、揭示期锁发射） | **被 §5 取代**：`world.phase` 为权威，收尾期与完成后仍可发射 |
| §7.1 / §7.2 类型与导出接口 | 增补见 §3；`Particle.targetX/targetY` 删除 |
| §11 硬约束中"成字稳定前 `#live` 为空" | 保留；"爆炸无整屏白闪"等其余不变 |
| §12.2 / §12.3 验收表与手动矩阵 | 旧显字行由 §8.3、§9 取代，其余行保留 |
| §13 里程碑 M2（计数与揭示） | 由 §10 的 M7–M10 追加，M2 表述改为历史 |
| spec 01 §14/§15 风险与升级路径 | 保留；新增风险见 §11 |

## 2. 现状核对：复用、替换与冲突

### 2.1 复用（不改或只加参数）

| 现有实现 | 处理 |
| --- | --- |
| `createRng` / 种子重放可复现 | 复用；`applyScene` 仅在种子变化时重建 `rng` |
| `launch` 火箭物理、`G`、`DAMP`、寿命、`TRAIL_GLYPHS` | 复用 |
| `explode` 的火花环生成（数量、角度、速度、ember 比例、颜色） | 复用；抽成 `emitSparks(world, x, y, n, opts)`，收尾小烟花调用同一函数 |
| `compact` 就地压缩、`enforceCap` "不丢 text/rocket" 规则 | 复用；`glue`/收尾粒子都是 `kind: "text"`，天然受保护 |
| `sampleTargets` 的排版与采样数学（字号自适应、`step`、`limit`、stride 抽稀） | 复用；删除洗牌、改 `limit`（§4.1） |
| `render` 的层序（装饰 → 文字在前）、`glyph`/字体/`textSize` | 复用；呼吸改为纯 alpha |
| `setViewport` 的等比缩放 | 复用；删除"立即完成"分支 |
| main 的 rAF/暂停、`heardBlasts` 音效、编辑器防抖、`clampMessage`、分享、`#aura` ≤0.12、`#live` 完成态兜底 | 复用 |

### 2.2 替换（本轮必须删掉或改写）

| 现有实现 | 位置 | 处理 |
| --- | --- | --- |
| `REVEAL_AFTER = 7` | `main.ts` | 删除；改为 `world.playerBlasts >= 10`，触发点在 `fireworks.ts` |
| `beginReveal` / `pairTargets` | `fireworks.ts` | 删除；目标改为开场采样、按接触占据 |
| `stepText` 弹簧时间线 + `REVEAL_DONE` | `fireworks.ts` | 删除 |
| `REVEAL_DEADLINE = 3.9` 硬截止吸附 | `fireworks.ts` | 删除；有限完成改由收尾调度保证（§4.5） |
| `retarget` / `settleReveal` / `allSettled` | `fireworks.ts` | 删除；由 `applyTargets` 迁移 + 完成判定取代 |
| `Particle.targetX/targetY`、`settled` 语义 | `fireworks.ts` | 删除坐标缓存（改为按 `targetId` 查槽位）；`settled` 保留为"已落定" |
| 呼吸的 `±BREATH_AMP px` 上下位移 | `render` | 改为 alpha 呼吸（§4.7） |
| `world.revealT` | `fireworks.ts` | 拆成 `clock` / `finaleT` / `settleT`（§3.2） |
| 揭示期 `fire()` 直接 return | `main.ts` | 改为只拦 `loading` |
| `state` 与 `world.phase` 双份转换逻辑（`advance`） | `main.ts` | 改为 `world.phase` 权威的单向同步（§5.1） |
| `activeCount` | `fireworks.ts` | 未被使用，删除（保持无死代码） |

### 2.3 与既有文档/评审的冲突与遗留

- 冲突：spec 01 §7.6 明写"硬截止无条件吸附剩余文字粒子"，与本轮"不允许远处瞬移兜底"直接矛盾 → 以上表为准。
- 冲突：spec 01 §8.1 的"锁定发射"副作用与 §8.2 的"`revealing` 阶段忽略一切发射输入"，与设计 02"收尾期继续放普通烟花"矛盾 → 以设计 02 为准。
- 沿用评审遗留项（`.agents/review/01-acceptance-review.md`）：`hashchange` 视为新场景重置（已有实现，保留）、空文案期间累计的爆炸不触发显字（§5.4 重新落实）、`heardBlasts` 归零（保留）、`body { touch-action: none }` 删除（已修，保留）、`#live` 完成态可见兜底（保留）。
- 未发现无法兼容的设计要求。两个需要落成工程规则的点见 §12。

## 3. 数据契约

> **spec 03 §2 扩展**：`Target` 增可选 `glyph`；采样输出为 `GlyphTarget extends Point`；
> `world.textFontSize` + `world.textLines` 由 `world.textLayout: TextLayout | null` 取代。
> 本节其余不变量（唯一占据、`order` 身份、阶段）继续有效。

### 3.1 类型（`src/fireworks.ts`）

```ts
/** 目标槽位状态：唯一占据，只有 stuck 计入完成度。 */
export type TargetState = "free" | "reserved" | "stuck";

export interface Target {
  x: number;
  y: number;          // CSS px
  order: number;      // 采样扫描序下标（迁移身份，§4.9）
  state: TargetState;
  holder: Particle | null; // 占据者（对象引用，压缩数组后仍有效）
}

export interface Batch {
  idx: number[];      // 本朵小烟花负责的目标下标
  x: number;
  y: number;          // 绽放位置（从该组质心向画面中心偏移）
}
```

`Particle` 在现有字段上增补（全部可选，保持 `erasableSyntaxOnly`）：

```ts
  /** 生成瞬间决定：诞生时处于积累期且有粘附资格的火花。 */
  glue?: boolean;
  /** 颜色角色：0..2 = sparks，3 = rocket/hot，4 = glow。换配色时按它重映射。 */
  tone?: number;
  /** 文字粒子：所占据的目标下标（唯一目标身份，不缓存坐标）。 */
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
```

`World` 增补：

```ts
  blasts: number;        // 总爆炸数（含收尾小烟花）→ 音效/调试
  playerBlasts: number;  // 玩家火箭爆炸数 = 轮数，只有它触发收尾
  targets: Target[];     // 空数组 = 无可显文字（空祝福或尚未采样）
  stuck: number;         // 已落定槽位数（完成度分子）
  reserved: number;      // 已预留在途槽位数
  clock: number;         // 全阶段模拟时钟（呼吸相位）
  finaleT: number;       // 收尾累计（revealing 期间）
  settleT: number;       // 完成累计（settled 期间）→ 颜色统一进度
  batchTimer: number;    // 下一波小烟花的倒计时
  batchSize: number;     // 本次排程固定的每波批次数
  batchInterval: number; // 本次排程固定的波间隔
  queue: Batch[];        // 待绽放批次；在途粒子不在队列里
  captureR: number;      // 接触半径（由 step 推导）
  step: number;          // 采样步长（迁移容差用）
  bounds: { x0: number; y0: number; x1: number; y1: number }; // 目标 AABB
  grid: Map<number, number[]>; // 目标空间桶：cellKey → 目标下标
  gridCell: number;
  gridCols: number;
```

删除 `revealT`、`Particle.targetX/targetY`。`free` 不设计数器：`free = targets.length - stuck - reserved`（MUST）。

### 3.2 常量（语义 + 是否已验证）

| 常量 | 取值 | 来源 | 语义与不可破坏性 |
| --- | --- | --- | --- |
| `PLAYER_BLASTS_TO_FINALE` | `10` | 产品决策 | 轮数阈值；**不得**按点击或总爆炸计数 |
| `TEXT_SHARE` | `0.55` | 本文工程取值 | 目标点上限 = `floor(cap * TEXT_SHARE)`；必须在 1800/640 两档都为升空、装饰、在途留出空间（回写 2026-09 rev2：1200/420 → 1800/640，比例不变） |
| `GLUE_SHARE` | `0.45` | 本文，待视觉验证 | 每次爆炸中带粘附资格的火花比例；保证"整朵不会全冻在文字上" |
| `CAPTURE_STEP_MUL` | `1.2` | 设计"约一个采样间距" | 接触半径 = `clamp(step * 1.2, CAPTURE_MIN, CAPTURE_MAX)` |
| `CAPTURE_MIN` / `CAPTURE_MAX` | `8` / `24` px | 本文，待视觉验证 | 接触半径上下限；上限即"不允许远距离磁吸"的硬边界 |
| `STICK_TIME` | `0.18` s | 设计 0.1–0.25 s | 接触后减速到固定；**不得**变成持续游走 |
| `RESERVE_TTL` | `3` s | 本文工程取值 | 预留安全期限；超时释放并重排，保证不留永久缺口 |
| `FINALE_LEAD` | `0.35` s | 本文，待视觉验证 | 收尾第一朵小烟花前的停顿 |
| `FINALE_ACTIVITY` | `2.6` s | 设计 2–4 s | 活动时长上限：`interval = clamp(FINALE_ACTIVITY / waves, …)`，见 §4.5；与缺口数量无关 |
| `FINALE_WAVE_MAX` | `12` | 本文工程取值 | 最大波数：缺口再零碎，也只分 `waves = min(n, 12)` 波，保证活动时长有解析上界 |
| `FINALE_INTERVAL_MIN` / `FINALE_INTERVAL_MAX` | `0.18` / `0.8` s | 本文，待视觉验证 | 波间隔上下限：下限保证观感不被挤成一坨，上限保证缺口很少时不拖沓 |
| `BATCH_CELL` | `130` px | 本文工程取值 | 收尾分区边长（局部性上界） |
| `BATCH_MAX` | `90` | 本文工程取值 | 单朵补字火花上限；与 `TEXT_SHARE` 一起保证批次数有限 |
| `BLOOM_OFFSET` | `24` px | 核验修正 | 绽放点偏离缺口质心，避免单点缺口的粒子直接出生在终点 |
| `MAX_FLIGHT` | `170` px | 本文工程取值 | 单朵补字火花的最大飞行距离（"短程"硬边界） |
| `FILLER_SPEED` / `FILLER_FLIGHT_MIN` / `FILLER_FLIGHT_MAX` | `220` px/s / `0.35` / `1.2` s | 设计"有限时长局部轨迹" | 飞行时长 = `clamp(d / speed, min, max)` |
| `FILLER_SWAY_MAX` | `12` px | 本文，待视觉验证 | 弧度上限，避免"激光直线"观感 |
| `FILLER_FADE` | `0.35` s | 设计 low-motion 例外 | reduced motion 下的淡入时长（位置不移动） |
| `COLOR_FADE` | `0.8` s | 设计 0.6–1 s | 落定后统一到主题高亮色；只改颜色 |
| `BREATH_DEPTH` / `BREATH_HZ` | `0.14` / `0.4` | 设计"轻微低频亮度" | 仅 alpha，无位移；reduced motion 关闭 |
| `MIGRATE_TOL` | `max(1.5 * step, 12)` px | 本文工程取值 | 视口迁移匹配容差 |
| `HINT_DWELL` / `FINALE_HINT_DWELL` | `1.6` s / `2.4` s | 设计"短暂保留" | 提示驻留，纯 UI 计时器 |

`CAPTURE_MIN/MAX`、`STICK_TIME`、`FINALE_*`、`COLOR_FADE`、`BREATH_*`、`FILLER_SWAY_MAX` 一律**未经视觉验证**。

### 3.3 不变量（实现完成时逐条自查）

- 一个 `Target` 同时最多一颗粒子；`state === "reserved" | "stuck"` 时 `holder` 非空，`free` 时为 `null`。
- 预留与粒子转换**同帧完成**：不存在"已预留但粒子还是 spark"的中间帧，因此不存在该窗口内的被裁剪风险。
- `kind === "text"` 的粒子 `life === FOREVER`，永不参与寿命淘汰与上限裁剪（沿用 `enforceCap`）。
- 文字粒子的位置只有三种可能：粘附过渡插值、收尾飞行插值、等于目标坐标。没有第四种（**不允许瞬移**）。
- `stuck + reserved <= targets.length`；`reserved` 与槽位扫描结果一致（每次迁移后 `recount`）。
- 完成判定只看 `stuck === targets.length`，不看轮数、不看发射数、不看动画计时器。
- 收尾期与完成后玩家输入不改变 `targets` / `stuck` / `reserved` / `queue`，只产生普通粒子。
- 所有阶段时间由 `update(world, dt)` 的 `dt` 累加（`clock` / `finaleT` / `settleT` / `batchTimer`），**不得**用 `setTimeout` 或墙钟调度收尾与颜色过渡。
- 所有粘附判定**不消耗** `world.rng`（位置驱动，保证重放确定性）。

## 4. 算法

### 4.1 目标采样与身份（`sampleTargets` + `applyTargets`）

> **已被 spec 03 §4 取代**：采样改为「Unicode 分段 → 断行拟合 → 高分辨率遮罩 → 单元特征 →
> 方向字形 → 预算自适应」；`step` 改存 `cellH`，超限的 **stride 抽稀被禁止**（改为放大单元完整重生成）。
> `applyTargets` 的槽位初始化 / 迁移 / 桶重建 / 阶段补点契约不变，仅新增 `glyph` 透传。以下为历史文本。

`sampleTargets(world, message): { x, y }[]`（**唯一的 DOM 入口**）

- 复用现有排版数学：测量最宽行 → `size = clamp(min(sizeByWidth, sizeByHeight), 16, 140)` → `step = round(clamp(size / 8, 5, 16))` → `world.textSize = step * 1.05`。
- 离屏画布改为**模块级复用**（尺寸变化时才重设），消除 spec 01/评审 §3.7 的每次 resize 重新分配（MAY）。
- 扫描顺序：`y` 外层、`x` 内层，逐点判断 alpha > 128。**删除洗牌**——扫描序即目标身份顺序 `order`。
- `limit = floor(world.cap * TEXT_SHARE)`（1800 → 990；640 → 352；回写 2026-09 rev2：原 1200 → 660、420 → 231）。超限用现有 **stride 抽稀**：它沿扫描序均匀丢弃，保证每一行、每个字的主要笔画都留下至少一个采样点（不得随机抽稀）。
- 空格、空行、`message === ""` 不产生目标。空祝福返回 `[]`。

`applyTargets(world, points, step)`（**纯函数**，Node 可直接调用）

1. 生成新槽位数组：`{ x, y, order: i, state: "free", holder: null }`。
2. 用 §4.9 的迁移规则把旧占据搬到新数组（首次调用时旧数组为空，等价于纯初始化）。
3. `world.targets = next`；`world.step = step`；`world.captureR = clamp(step * CAPTURE_STEP_MUL, CAPTURE_MIN, CAPTURE_MAX)`；`world.bounds` = 目标 AABB；重建 `grid`（`gridCell = max(captureR * 2, 16)`，`gridCols = ceil(view.w / gridCell)`，`key = cy * gridCols + cx`，只存下标，查询时按 `state` 过滤）。
4. `recount(world)`；按阶段收尾：
   - `playing`：只迁移，不补点（"不能凭空补成整句"）。
   - `revealing`：`queue = planBatches(world)` 重排剩余缺口；在途补字粒子若目标仍存在则继续飞。
   - `settled`：对仍为 `free` 的新目标立即补齐（生成 `settled = true` 的文字粒子，`color = palette.glow`），保证"完成态重排后仍完整"。

`refreshTargets(world)` = `sampleTargets` + `applyTargets`（DOM 包装，main 调用）。

### 4.2 局部捕获（`tryCapture`）

**资格**（全部满足）：`p.glue === true`、`p.kind === "spark" || p.kind === "ember"`、`p.life > 0`、`world.targets.length > 0`、`free > 0`。

- `glue` 在**爆炸生成时**决定：`explode()` 只在生成瞬间 `phase === "playing"` 时为火花掷 `rng() < GLUE_SHARE`。因此第十次爆炸的火花即使在收尾开始后仍在飞，也继续正常粘附（设计"第十次仍正常积累"），而收尾开始之后的新爆炸与收尾自身火花天生没有资格（设计"后续玩家爆炸只作普通烟花"）。
- 候选只来自火花，不含火箭与尾迹（设计明示）。`glue` 判定按火花逐一掷骰，属于现有 `explode` 随机序列的一部分。

**接触检测（必须考虑帧内运动线段）**：

1. 物理积分前记录 `(x0, y0)`，积分后得 `(x1, y1)`；`update` 内部已把 `dt` 夹到 `1/30`，线段长度有界。
2. 早退：线段 AABB 与 `world.bounds`（各向扩 `captureR`）不相交 → 直接跳过（远处烟花零成本）。
3. 查询：遍历覆盖线段 AABB（扩 `captureR`）的桶，收集 `state === "free"` 的目标。
4. 取点到线段距离最小的目标；`d <= captureR` 才捕获；同距取 `order` 小者（确定性）。
5. 捕获动作（同一帧内一次性完成）：

   ```
   slot.state = "reserved"; slot.holder = p; world.reserved++;
   p.kind = "text"; p.targetId = idx; p.stickT = 0;
   p.fx = p.x; p.fy = p.y; p.life = FOREVER; p.maxLife = FOREVER;
   p.vx = 0; p.vy = 0;
   ```

   颜色与字形**不修改** → 保留来源色（设计"积累时保留来源色"）；`reducedMotion` 时 `p.fx = slot.x; p.fy = slot.y`（就地淡入）。
6. 已被占据的点不进入候选集合 → 重复经过不重染、不叠加（设计决策）。

MUST NOT：全量两两搜索；远程磁吸；在捕获时改写已有粘点。查询成本 = O(路径覆盖的桶数 × 桶内目标数)，与屏幕总目标数无关。

### 4.3 减速固定（`stepStick`）

```
u = min(1, (p.stickT += d) / STICK_TIME)
e = smoothstep(u)                     // 复用现有 smoothstep
p.x = p.fx + (t.x - p.fx) * e
p.y = p.fy + (t.y - p.fy) * e
u >= 1 → p.x = t.x; p.y = t.y; p.settled = true; 清空 stickT/fx/fy;
         slot.state = "stuck"; world.reserved--; world.stuck++;
```

- 接触半径 ≤ 24px，所以可见位移很小：表现为"短暂减速后固定"，与设计 0.1–0.25s 一致。
- 渲染 alpha：过渡中 `0.35 + 0.65 * smoothstep(stickT / STICK_TIME)`；落定后为 1（乘呼吸，§4.7）。
- reduced motion：位置已在目标上，只有 alpha 动（设计"用短淡入呈现局部新增粘点"）。

### 4.4 十轮与收尾触发（`startFinale`）

在 `update` 每次 tick 的**末尾**（物理与捕获之后）：

```
if (world.phase === "playing" && world.targets.length > 0
    && world.playerBlasts >= PLAYER_BLASTS_TO_FINALE) startFinale(world);
if (world.targets.length > 0 && world.stuck === world.targets.length) complete(world);
```

`startFinale(world)`：

```
if (world.phase !== "playing" || world.targets.length === 0) return;  // 幂等 + 空祝福
world.phase = "revealing"; world.finaleT = 0;
resetSchedule(world); // 固定 batchSize / batchInterval，首波等待 FINALE_LEAD
```

- 触发来自 `playerBlasts`，与点击次数、自动小烟花均无关；连续点击、多发在途、重复调用都只启动一次（幂等）。
- 提前入口（`#bloom`）调用同一函数：零轮可用；`revealing` / `settled` 时是 no-op。
- 收尾开始**不打断**已有粘附过渡、不取消在途预留（设计"保留第十发及更早火花已获得的有效预留"）。
- 自然提前补齐：`stuck === targets.length` 时即使 `phase === "playing"` 也直接 `complete`，不播放无意义的补洞表演。

`complete(world)`：`world.phase = "settled"; world.settleT = 0; world.queue.length = 0;`（完成信号，UI 由 main 侧同步）。

### 4.5 收尾分批（`planBatches` + `bloom` + `stepFlight`）

**分批**（收尾开始时一次，之后仅 resize 重排）：

1. `free` = 所有 `state === "free"` 的目标下标（`order` 升序）。
2. 用 `BATCH_CELL` 网格做初始分区；若单元格因稠密或偏斜不满足硬边界，则沿长轴递归二分。
3. 贪心合并相邻批次，只要满足 **两个硬约束**：`目标数 <= BATCH_MAX` 且 `质心到组内最远目标 <= MAX_FLIGHT - BLOOM_OFFSET`。
4. 批次按扫描序排列；每批 `x, y` 从目标质心向画面中心偏移 `BLOOM_OFFSET` 后夹到视口内。单点缺口也因此具有可见飞行段，不在终点直接生成粒子。

**调度**（"波" = 一批同时绽放的小烟花，在 `update` 的 `revealing` 分支）：

- 收尾开始（或重排）时算一次：

```
waves        = min(queue.length, FINALE_WAVE_MAX)
batchSize    = ceil(queue.length / waves)
batchInterval = clamp(FINALE_ACTIVITY / waves, FINALE_INTERVAL_MIN, FINALE_INTERVAL_MAX)
```

- `batchSize` 与 `batchInterval` 在本次排程中固定；若 resize 或预留失效导致重排，再重新计算一次。不得按每波的剩余队列反复重算，否则尾段会退化为一次只出一批并突破活动时长。
- 缺口零碎或视口很大时批次可能远多于 `FINALE_WAVE_MAX`：某一波同时绽放 `batchSize` 朵位于不同区域的小烟花，把排程压在至多 12 波内。补字粒子总数始终不超过目标数，预算由 `TEXT_SHARE` 约束。

```
world.finaleT += d;
world.batchTimer -= d;
if (world.batchTimer <= 0 && world.queue.length > 0) {
  for (let i = 0; i < world.batchSize && world.queue.length > 0; i++) {
    bloom(world, world.queue.shift()!);
  }
  world.batchTimer += world.batchInterval;
}
checkReservations(world);   // TTL 安全网，见本节末
```

**`bloom(world, batch)`**：

- 装饰：`emitSparks(world, x, y, 18 + floor(rng() * 10), { glue: false, speed: 60 + rng() * 90, life: 0.6 + rng() * 0.7 })`——与玩家爆炸共用同一生成器，视觉同族但更小。
- 补字：批内每个目标生成一颗粒子（`kind: "text"`）：

  ```
  d   = hypot(t.x - x, t.y - y)
  dur = clamp(d / FILLER_SPEED, FILLER_FLIGHT_MIN, FILLER_FLIGHT_MAX)
  p = { x, y, vx: 0, vy: 0, life: FOREVER, maxLife: FOREVER,
        glyph: GLYPHS[rng() * len | 0], color: sparks[rng() * 3 | 0], tone,
        kind: "text", targetId: idx, fx: x, fy: y,
        flightT: 0, flightDur: dur, sway: (rng() * 2 - 1) * min(FILLER_SWAY_MAX, d * 0.15),
        settled: false }
  slot.state = "reserved"; slot.holder = p; world.reserved++;
  ```

- `world.blasts++`（总计数，供音效；**不动** `playerBlasts`，设计"自动烟花不计轮数"）。
- reduced motion：`fx = t.x; fy = t.y; flightDur = FILLER_FADE; sway = 0`（就地淡入，不播放大幅运动）。

**`stepFlight(p, d)`**：

```
u = clamp((p.flightT += d) / p.flightDur, 0, 1)
e = smoothstep(u)
perp = normalize(-(t.y - p.fy), t.x - p.fx)
p.x = p.fx + (t.x - p.fx) * e + perp.x * sin(PI * u) * p.sway
p.y = p.fy + (t.y - p.fy) * e + perp.y * sin(PI * u) * p.sway
u >= 1 → 同 §4.3 的落定收尾（slot → stuck）
```

**有限完成性（按构造，不是按运气）**：

- 每颗补字粒子有固定飞行时长：正常模式 `flightDur = clamp(d / FILLER_SPEED, FILLER_FLIGHT_MIN, FILLER_FLIGHT_MAX)`，且 `0 < d <= MAX_FLIGHT` ⇒ `flightDur <= 0.77s`（reduced motion 覆盖为 `FILLER_FADE`）。起点是偏离缺口质心的可见小烟花位置，末段 `smoothstep` 自动减速，落点即目标坐标 → 不存在超时兜底，也不存在瞬移。
- 波数有上界：`waves = min(n, FINALE_WAVE_MAX) <= 12`。因此活动时长 = `waves * interval`：`waves ∈ [4, 12]` 时 `interval = FINALE_ACTIVITY / waves` ⇒ 活动 ≈ `2.6s`；`waves <= 3` 时 `interval` 取上限 `0.8s` ⇒ 活动 `<= 2.4s`。**活动时长按构造 `<= FINALE_ACTIVITY`，与缺口数量、视口大小、目标总数无关**——这正是 `FINALE_WAVE_MAX` 的作用。
- 端到端上界（解析值，非实测）：`FINALE_LEAD + FINALE_ACTIVITY + flightDur_max ≈ 0.35 + 2.6 + 0.8 ≈ 3.8s`；缺口很少时 ≈ 1.5–2.5s。真实观感仍需 §8.3 记录。
- 速度上界（与帧长无关，可判定）：飞行路径的 `smoothstep` 最大斜率为 1.5，故 `|v| <= 1.5 * MAX_FLIGHT / FILLER_FLIGHT_MIN ≈ 730px/s`，加上弧度贡献 `π * FILLER_SWAY_MAX / FILLER_FLIGHT_MIN ≈ 108px/s`，合计 `<= 900px/s`（60fps 下 ≤ 15px/帧，`dt` 夹到 `1/30` 时 ≤ 30px/帧）；接触过渡 `<= 1.5 * CAPTURE_MAX / STICK_TIME = 200px/s`。这是测试断言"不瞬移"的可判定依据。

**TTL 安全网（`checkReservations`，每 0.5s 一次）**：扫描 `reserved` 槽位，若 `holder` 已被移除或超过 `RESERVE_TTL` 仍未落定 → `releaseSlot`（槽位回 `free`、`reserved--`；粒子的 `targetId` 清空，转为寿命 0.4s 的装饰 `spark`），并在 `revealing` 时重排 `queue`。正常情况下这条路径不会被触发，它保证"预留失效 → 释放补齐"的语义在任何异常下都成立。

### 4.6 完成与颜色统一

- 完成判定只依赖 `stuck === targets.length`（在途、预留、动画计时器都不算数）。
- 进入 `settled` 后 `world.settleT += d`；`progress = clamp(world.settleT / COLOR_FADE, 0, 1)`。
- 文字层颜色 = `mixHex(p.color, palette.glow, smoothstep(progress))`；`progress >= 1` 后直接用 `palette.glow`。
- `mixHex` 为纯函数（`#rrggbb` → 分量线性插值 → `rgb()` 字符串），渲染时按 `(源色, 量化进度)` 做小缓存（进度量化到 1/16，最多 17 档）+ 每个源色一份，避免逐粒子逐帧字符串分配；来源色种类上限 5（sparks[0..2]、rocket/hot、glow）。
- 只改颜色：位置、字形、`targets` 不变（设计"只改变颜色"）。

### 4.7 呼吸（纯亮度）

- `alpha = 1 - BREATH_DEPTH * (0.5 + 0.5 * sin(2π * BREATH_HZ * world.clock))`，整段文字共享相位。
- 只作用于 `state === "stuck"` 的粘点与完成后的文字；过渡中/飞行中的粒子用各自 fade，避免双重呼吸。
- 不修改 `x/y`（设计明示：去掉上下位移）。
- `reducedMotion` → 恒为 1。
- `world.clock` 全阶段累加，暂停时不前进。

### 4.8 预算保护

- 目标上限 `floor(cap * TEXT_SHARE)`（正常 990、低动态 352）；**先保证每个字都有采样**，再抽稀密度。
- `compact` / `enforceCap` 规则不变：`kind === "text"` 与 `rocket` 不淘汰；被淘汰的只有 trail/ember/spark，因此"粘点与有效补字粒子不被装饰粒子挤掉"自动成立。
- 过渡中的粘附粒子与在途补字粒子都是 `kind: "text"`，同样受保护。
- 装饰降级 SHOULD：`world.particles.length > cap * 0.8` 时跳过尾迹生成（每帧一处判断）；收尾小烟花装饰量低于玩家爆炸（§4.5）。
- 连点：沿用现有输入路径（无额外节流），但装饰粒子上限裁剪与目标保护已经保证补字不被挤掉；`fire()` 不再锁发射。
- MUST NOT：为目标预生成粒子（目标先是纯坐标，被占据时才成为粒子）、引入对象池、新增依赖。

### 4.9 视口迁移（`applyTargets` 的迁移规则）

对旧数组中 `state !== "free"` 的槽位，按**采样序比例 + 局部最近点**搬迁占据：

```
ratio  = next.length / max(1, prev.length)
base   = round(slot.order * ratio)
win    = max(2, ceil(ratio * 4))
best   = 在 next 的 [base - win, base + win] 中，取仍为 free 且距离最近的下标
if (best 存在且 dist <= MIGRATE_TOL) 迁移：
    holder.targetId = best; next[best].holder = holder;
    next[best].state = holder.settled ? "stuck" : "reserved"
else 释放：
    holder.kind = "spark"; holder.life = holder.maxLife = 0.4;
    delete holder.targetId / stickT / flightT / flightDur / settled / fx / fy;
    槽位被丢弃（新数组里对应位置保持 free）
```

理由：扫描序在 (文案, 视口) 下确定，比例映射等价于"按字序与字形内相对位置"迁移，比绝对像素或全量最近邻匹配都更便宜、更可测；`MIGRATE_TOL` 挡住跨字错配。允许采样数量变化造成小幅覆盖差异（设计允许），不允许凭空补成整句。

阶段相关行为（`refreshTargets` 收尾）：

- `playing`：只迁移（释放的粒子自然淡出，新空目标等待玩家）。
- `revealing`：`queue = planBatches(world)` 重排；在途补字粒子若 `targetId` 迁移成功则继续飞向新坐标，否则已被释放。
- `settled`：空目标立即补齐为 `stuck`（保持完整，不播放动画）。

### 4.10 生命周期与并发输入

| 场景 | 规则 |
| --- | --- |
| 重放（`#replay`） | `resetScene`：清粒子；`blasts/playerBlasts/stuck/reserved/clock/finaleT/settleT/batchTimer/batchSize/batchInterval` 归零；`queue` 清空；所有槽位回 `free`（保留目标点与网格）；`phase = "playing"`；`rng` 重建；main 侧 `heardBlasts = 0` |
| 修改祝福文字 | 结构性变更：`applyScene` 内部做与重放等价的完整重置，**并清空 `targets` 与网格**（防止旧字残影被当作新进度）；main 立即执行（不等防抖）以免在编辑器背后触发收尾，200ms 后再采样（`refreshTargets`）；计数器归零后也不会再触发 |
| 输入防抖 | 沿用现有 200ms 定时器：**立即**重置世界，**防抖**才写 URL 与重采样（昂贵的是全屏 `getImageData`）；采样期间 `targets` 为空 ⇒ 不会捕获、不会收尾 |
| 仅换配色 | 不重置：保留覆盖、预留、阶段与时钟；按 `tone` 重映射颜色（`tone` 缺失的旧粒子退回现有 kind 映射）；完成态统一色改用新 `palette.glow` |
| 重新生成种子 | 视为新场景：`targets` 清空 + 完整重置；main 重采样 |
| 外部分享链接导航（`hashchange`） | 与种子变化同处理：先完整重置再采样，不继承旧进度、不泄露新祝福 |
| 调整视口 / 旋转 | `setViewport` 等比缩放粒子、飞行起点与**旧目标坐标**，并重建旧目标的 AABB/空间桶；main 随后 `refreshTargets`（§4.9）在同一坐标系迁移。积累期不突然完成、不清空；收尾期重排缺口；完成态仍完整 |
| 页面隐藏 | 沿用 `stop()` / `start()`；所有时钟与批次倒计时都靠 `dt` 推进，恢复不堆积补发；`start()` 重置 `last`（已有实现） |
| 空祝福 | `targets = []`：不捕获、`startFinale` no-op、永不"完成"；`#bloom` 隐藏；自由烟花照旧 |
| 收尾中/完成后输入 | `launch` 正常；不参与目标分配（新爆炸的火花没有 `glue`）；不延长收尾、不重排 |
| reduced motion | 保留 10 轮与两阶段语义；接触与补字改为就地淡入（`FILLER_FADE`）；关闭呼吸；沿用完成态可见 DOM 祝福；完成时才写 `#live` |

## 5. `main.ts`：状态机、DOM 与输入

### 5.1 阶段同步（`world.phase` 权威）

删除 `advance()` 里的 `REVEAL_AFTER` 分支，改为单向同步：

```ts
function syncPhase(): void {
  if (state === "loading" || state === world.phase) return;
  state = world.phase;
  if (state === "revealing") { /* hint 收尾文案 + 显示；aura 0.12；#bloom 隐藏 */ }
  else if (state === "settled") { /* live = scene.message；#replay 显示；aura 0 */ }
  else { /* playing：hint 复位；live 清空；#replay 隐藏；#bloom 按文案可见 */ }
}
```

`frame()` 里每帧调用一次（在 `update`/`render` 之后）。`playing → settled` 的直跳（自然提前补齐）由同一分支处理，因此不需要单独判断。

### 5.2 DOM 契约变化

| 元素 | 变化 |
| --- | --- |
| `#bloom`（新增按钮） | `<button id="bloom" type="button">让祝福完整绽放</button>`，放在 `#controls` 内（`#sound` 之后）。可见性：`state === "playing" && scene.message !== ""`；`revealing` / `settled` / 空祝福 / `loading` 时 `hidden`。点击 → `startFinale(world)` + `syncPhase()`；重复点击 no-op（幂等）。样式沿用现有 `button`（含 44px 触摸目标与 `:focus-visible`） |
| `#hint` | 初始文案改为 **把烟花放在不同的地方，看看留下了什么。**；收尾开始改为 **还有几束光，正在找它们的位置。** 并在 `FINALE_HINT_DWELL` 后淡出；重放/新场景复位初始文案。首次发射后延迟 `HINT_DWELL` 再淡出（"短暂保留"）。提示只含诗意文案，不含祝福内容、轮数、覆盖率或进度条 |
| `#replay` | 语义不变：`settled` 时出现 |
| `#live` | 语义不变：只在整个文字落定后写入完整祝福（可访问性播报），不逐点播报 |
| `#aura` | 保持既定行为（收尾期 ≤ 0.12，完成回落 0），设计 02 未改动 |

MUST NOT：为进度新增 DOM（进度条/计数/百分比）；把祝福写进标题、按钮或提示。

### 5.3 输入

- `fire()` 只在 `state === "loading"` 时返回；`playing` / `revealing` / `settled` 均可发射（设计"收尾期间及完成后仍可自由放普通烟花"）。
- 键盘发射路径不变（含控件/对话框焦点排除）。
- 编辑器打开时照常可以发射（对话框是 `showModal`，画布点击被遮挡，键盘发射按现有规则仍排除 `dialog` 内目标）。

### 5.4 场景提交（`commitScene` / `syncMessage`）

```ts
function commitScene(next: SceneConfig): void {
  const structural = next.seed !== scene.seed || next.message !== scene.message;
  scene = next;
  jitterRng = createRng(scene.seed ^ 0x9e3779b9);
  applyPaletteVars(scene);
  applyScene(world, scene);              // 结构性：内部完整重置并清空 targets
  if (structural) refreshTargets(world); // 重采样（DOM）
  history.replaceState(null, "", writeSceneToHash(scene));
  syncPhase();
  updateCounter();
}
```

- `syncMessage()`：文案一变就**同步**调用 `applyScene`（结构性重置，计数器归零），再走 200ms 防抖里的 `commitScene`。这样"先空放 10 次再写字"不会在对话框背后立刻收尾（评审遗留 §3.2 的同类缺陷）。
- `applyScene(world, scene)`（fireworks 侧）：
  - 结构性（`seed` 或 `message` 变化）：清粒子与全部计数/时钟/队列、槽位回 `free`、`targets` 清空与网格清空、`phase = "playing"`、`rng = createRng(seed)`（注意：只有结构性变更才重建 `rng`）。
  - 仅配色：不改 `phase` / `targets` / 计数，只按 `tone` 重映射粒子颜色。
  - 保留函数签名 `applyScene(world, scene): void`，不引入新文件。
- `resize()`：现有尺寸早退判断保留；尺寸真变化时 `canvas.width/height` → `setViewport` → `refreshTargets`。
- 字体时序：目标采样必须在 `document.fonts.load('13px "ascii-mono"')`（或 1500ms 超时）之后进行，否则 CJK 度量抖动会让首次采样与最终排版不一致；顺序为：字体等待 → `state = "playing"` → `refreshTargets(world)` → `start()`。

## 6. 文件改动计划

| 文件 | 改动 |
| --- | --- |
| `src/fireworks.ts` | 新增：`Target`/`Batch`/`TargetState`、`applyTargets`、`refreshTargets`、`sampleTargets`（改写）、`startFinale`、`planBatches`、`bloom`、`emitSparks`（从 `explode` 抽出）、`tryCapture`、`releaseSlot`、`stepStick`、`stepFlight`、`recount`、`checkReservations`、`mixHex`、`complete`。改写：`createWorld`、`update`、`render`、`setViewport`、`applyScene`、`resetScene`、`explode`。删除：`beginReveal`、`pairTargets`、`retarget`、`settleReveal`、`stepText`、`allSettled`、`activeCount`、`REVEAL_DONE`、`REVEAL_DEADLINE`、`targetX/targetY`、呼吸位移 |
| `src/main.ts` | 删除 `REVEAL_AFTER`；`advance` → `syncPhase`；`fire()` 只拦 `loading`；`#bloom` 事件与可见性；`#hint` 文案与停留；`commitScene` / `syncMessage` / `resize` / `toPlaying` 按 §5 调整；初始化顺序（字体等待后采样） |
| `index.html` | 新增 `#bloom` 按钮；`#hint` 初始文案替换 |
| `src/style.css` | 原则上不改；如需为 `#bloom` 复用一个现有按钮样式。**不新增**进度类样式 |
| `src/fireworks.test.ts` | 删除"揭示硬截止"用例；新增 §8.1 用例 |
| `src/scene.test.ts` | 不改（URL 契约不变） |
| `README.md` | 实施后同步"粘附显字 / 十轮收尾 / 提前绽放"一句话与不变项（分享仍只带祝福+配色+种子） |
| `.agents/spec/01-*.md` | 实施后按 §1 的表标注被取代条目（不改历史结论） |
| `.agents/review/` | 实施后新增 `02-*.md` 记录视觉与真机验收；本轮不动 |

不新增文件、不新增依赖、不引入框架、不改 `scene.ts` / `wrangler.jsonc` / `package.json`。

## 7. 旧契约迁移清单（删除项，防止回潮）

- 删除 `REVEAL_AFTER = 7` 与"第七次爆炸"相关注释/文案。
- 删除 `REVEAL_DEADLINE`、`REVEAL_DONE` 以及一切"到点无条件吸附/瞬移"的兜底。
- 删除 `pairTargets` 的"粒子多于目标 → 剩余保持背景烟花"逻辑（新机制下不需要配对，目标只由接触或收尾占据）。
- 删除稳定文字的 y 方向呼吸位移。
- 删除视口/场景变化时的"立即完成"（`settleReveal` 路径）；`settled` 的即时补齐只服务于"完成态重排后仍完整"。
- 更新 spec 01 §7.6 / §7.7 / §8.1 / §11 / §12.2 / §13 的对应表述；README 不再描述"第七次揭示"。

## 8. 测试与验收

### 8.1 Node 自动化（`src/fireworks.test.ts`，`node --test`）

样本注入：测试**不调用** `sampleTargets` / `refreshTargets`（它们依赖 DOM canvas）。改用纯函数 `applyTargets(world, points, step)` 注入目标点，用 `launch` / 手工粒子 / `startFinale` 驱动。所有新增用例都必须能在 Node 无 DOM 环境下运行。

| # | 用例 | 关键断言 |
| --- | --- | --- |
| 1 | 槽位初始化与计数 | `applyTargets` 后 `targets.length === n`、`stuck === 0`、`reserved === 0`；`recount` 与扫描一致 |
| 2 | 局部捕获与唯一占据 | 一颗 `glue` 火花飞越两个相邻空闲目标的路径 → 恰好 1 个变 `reserved`，另一个仍 `free`；`slot.holder === p` |
| 3 | 接触半径硬边界 | 目标距路径 200px 时，3s 模拟内永不捕获（"不允许远距离磁吸"可判定） |
| 4 | 减速固定与来源色 | 捕获后 `STICK_TIME + ε` 内 `settled === true`、位置等于目标坐标、`glyph` 与 `color` 与捕获前一致、`life === FOREVER` |
| 5 | 重复命中不改变文字 | 对已 `stuck` 目标再打 30 帧 glue 火花 → 位置/颜色/字形不变，该目标仍只有 1 颗粒子 |
| 6 | 粘点持久性 | 持续 20s 连点 + `cap = 200` 压力下，粘点数量只增不减 |
| 7 | 玩家/自动计数分离 | `launch` → `blasts` 与 `playerBlasts` 同时 +1；`startFinale` 后的 `bloom` → `blasts` +1、`playerBlasts` 不变 |
| 8 | 触发幂等 | 连续两次 `startFinale` → `phase` 仍 `revealing`、`queue` 长度与首次一致、在途补字粒子数不翻倍 |
| 9 | 零轮提前收尾 | 120 个目标、0 轮 → `startFinale` 后模拟 ≤ 6s：`stuck === 120`、`phase === "settled"` |
| 10 | 最差落点有限补齐 + 不瞬移 | 240 个目标、0 轮：6s 内完成；逐帧对"上一帧已存在"的文字粒子断言 ` | Δ位置 | / dt <= 900 px/s`；每颗补字粒子满足`0 < hypot(fx - t.x, fy - t.y) <= MAX_FLIGHT`（终点在目标上、起点在小烟花，不存在起点即终点） |
| 11 | 持续输入不阻塞 | `revealing` 期间每 0.2s 发射一枚：仍在用例 10 的时限内完成；`stuck` 单调不减；`queue` 完成后为空 |
| 12 | 自然提前补齐 | 以 glue 火花填满全部目标（`playing` 内）→ `phase` 直接 `settled`，不经过 `revealing` |
| 13 | 预算保护 | `cap = 200`、12 发连点：所有 `kind === "text"` 粒子保留；`nonRocket.length <= cap`；`particles.length <= cap + 火箭数`；被裁掉的只有 trail/spark/ember |
| 14 | 重置取消旧任务 | `startFinale` → `resetScene`：`phase === "playing"`、`queue` 空、`blasts/playerBlasts/stuck/reserved/settleT/finaleT` 全 0、所有槽位 `free`；再次收尾仍能完成 |
| 15 | 视口迁移不提前完成 | 积累若干粘点后 `applyTargets` 到平移+缩放的点集：`phase` 仍 `playing`、`stuck` 不增、存活的粘点位置等于新目标坐标、被释放的粒子变成有寿命的装饰粒子 |
| 16 | 完成态重排仍完整 | `settled` 后 `applyTargets` 到更密的点集：模拟一帧后 `stuck === targets.length`、`phase === "settled"` |
| 17 | 空祝福不越界 | `targets` 为空时 `startFinale` no-op；10 次爆炸后 `phase` 仍 `playing` |
| 18 | 颜色统一与呼吸 | `mixHex('#ffffff', '#000000', 0.5)` 落在中间值；`settleT = 0` 时文字解析色 = 来源色，`settleT >= COLOR_FADE` 时 = `palette.glow`；呼吸只改 alpha（同 `clock` 下两次渲染的 `x/y` 相同） |
| 19 | 保留既有契约 | `createRng` 可复现、默认上限 1800/640、resetScene 归零、七发火箭全部爆炸等旧用例继续通过（用例名与断言保持，除非被本文取代） |

### 8.2 自动化完成契约 vs 人工视觉

- 自动化能证明：目标唯一占据、粘附局部性、粘点持久、轮数来源正确、触发幂等、有限时长补齐、位移有界（不瞬移）、预算保护、重置/迁移不越界、空祝福与 reduced motion 不收尾。
- 自动化**不能**证明：胶水手感、局部性观感、补字粒子"看得见来源"、最长祝福可读性、帧时间达标、提示文案节奏、颜色过渡是否柔和。这些只能由 §8.3 的人工观察判定，且必须在结论里写明观察方式与设备。
- 禁止把"测试通过"当作视觉验收通过；禁止在视觉未验证时把 §3.2 的数值写成已定结论。

### 8.3 人工视觉矩阵（必须逐格填观察结果）

| 场景 | 观察点 |
| --- | --- |
| 开场与首轮 | 无文字底图/轮廓/占位点；第一发靠近笔画即留下粘点；远处位置只放普通烟花、不增加粘点 |
| 局部积累 | 左右分区燃放时，新增粘点集中在爆点附近的笔画；未接近笔画的火花正常消散 |
| 粘点质感 | 落点不漂移；只有轻微亮度呼吸；被后来烟花穿过时颜色与亮度不变 |
| 收尾来源 | 慢放可见补字火花从缺口附近的小烟花飞出、末段减速落到点上；无全句淡入、无远处瞬移、无全屏回流 |
| 收尾节奏 | 记录实际活动动画时长（目标 2–4s）；缺口多时不应拖到令人等待 |
| 最差落点 | 十发全部放在角落 → 仍能补齐全部笔画，不需要继续点击 |
| 持续连点 | 收尾中连续点击：补齐不被拖延、文字不被破坏、普通烟花照常 |
| 颜色 | 积累时是来源色；最后一颗落定后柔和统一到主题高亮色（约 0.6–1s），位置不动 |
| 提前绽放 | 零轮点击与中途点击都从当前状态补齐；连点不重启、不重复绽放 |
| 长文本与低预算 | 3 行 × 60 字中文完整可读；低动态下仍能读（含可见 DOM 兜底） |
| reduced motion | 无大幅运动、无闪烁、局部短淡入；入口可跳过等待；完成后 `#live` 可见 |
| 视口 | 积累中/收尾中旋转屏幕：不突然完成、不清空、缺口重排；完成态仍完整 |
| 生命周期 | 重放、改文案（含"先空放再写"）、换配色（仅换色不清进度）、换链接、换种子、切后台 10s 返回（无堆积补发） |
| 性能 | 正常与低动态两档：最长文本 + 收尾 + 连点下的帧时间；记录设备/浏览器/实测值 |
| 可访问性 | 键盘发射在收尾中仍可用；对话焦点与触摸目标不回退；完成时才播报祝福 |

### 8.4 记录要求

沿用 spec 01 §12.4：每个里程碑在提交描述里写跑过的命令、设备/浏览器、实测帧时间、被跳过的检查与原因。不写"应该没问题"，只写观察到的现象。

## 9. 验收命令

```bash
pnpm install --frozen-lockfile
pnpm test                                   # node --test，含 §8.1 新用例
pnpm build                                  # tsc --noEmit + vite build
pnpm preview                                # 手动矩阵主入口（localhost = 安全上下文）
pnpm check:deploy                           # wrangler deploy --dry-run，退出码 0
pnpm run deploy                             # 部署（不能写 pnpm deploy）
pnpm dev --host                             # 真机局域网（非安全上下文，验证分享兜底）
pnpm build && pnpm exec wrangler dev        # 验证 _headers: curl -sI http://localhost:8787/ | grep -i content-security-policy
```

不新增脚本、不新增测试框架、不新增 lint 工具。§8.3 的视觉项必须在 `pnpm preview`（或已部署站点）的人工观察中留记录；本规格本身不产生任何"已验证"结论。

## 10. 里程碑（jj 一个 change 一个里程碑，接续 M6）

| # | 范围 | 完成信号（可运行检查） |
| --- | --- | --- |
| M7 | 目标与积累：`Target`/`applyTargets`/`refreshTargets`/空间桶、接触捕获、减速固定、粘点保护、alpha 呼吸、预算比例 | `pnpm test` 用例 1–7、13、17 通过；`pnpm build` 通过；`pnpm preview` 手动确认"第一发即可能留下粘点" |
| M8 | 收尾与完成：`startFinale`/`planBatches`/`bloom`/`stepFlight`、完成判定、`mixHex` 统一色、`#bloom` 入口与文案 | 用例 8–12、18 通过；`pnpm preview` 手动确认零轮提前绽放与最差落点补齐 |
| M9 | 生命周期与迁移：resize/编辑/防抖/重放/hashchange/后台/reduced motion/空祝福、删除旧契约 | 用例 14–16、19 通过；`pnpm build`、`pnpm check:deploy` 通过；手动矩阵中的生命周期与视口行填完 |
| M10 | 视觉调参与文档：时长/半径/比例调参、长文本可读性、帧时间、README 与 spec 01 同步、新增 review 02 | 真机（至少一台）矩阵与帧时间记录；`pnpm check:deploy` 通过；文档不再描述第七次揭示 |

M7–M9 内不得顺手调 §3.2 的数值（除明确标注"待视觉验证"的调参项）；数值改动集中在 M10，并在提交里写观察依据。

## 11. 风险与开放项

| 风险 | 处理 |
| --- | --- |
| 参数（接触半径、粘附比例、收尾节奏、统一色时长）只有设计区间，没有实测 | 集中在 §3.2 标注；M10 用录屏/真机观察逐项调，改动写进提交描述 |
| 3 行 × 60 字在 990/352 点上限下的可读性 | 采样必须保证"每字有笔画点"；M10 人工判定；不足时先提 `TEXT_SHARE`，再降采样步长上限，不牺牲完整补齐 |
| 收尾节奏的观感：活动时长已按构造 ≤ `FINALE_ACTIVITY`，但"一波同时绽放多朵小烟花"在缺口零碎时是否显得杂乱 | 属待视觉验证；M10 用 `FINALE_WAVE_MAX` / `FINALE_ACTIVITY` / `BATCH_CELL` 三个旋钮调，任何情况下都不引入瞬移 |
| 视口迁移按扫描序比例映射，长宽比剧变时可能释放偏多粘点 | 属设计允许的小幅差异；M10 观察横竖屏切换；必要时收紧 `MIGRATE_TOL` |
| 每次编辑/旋转都做一次全屏采样（`getImageData`） | 离屏画布模块级复用 + 200ms 防抖；M10 在真机记录一次采样耗时 |
| 990 个永久文字粒子 + 装饰 + 在途的帧时间 | 文字只在占据时才成为粒子；`enforceCap` 保护 text；M10 记录帧时间，必要时降 `TEXT_SHARE` |
| 完成态 resize 会即时补齐新目标（可见小幅"跳出"） | 设计只要求"完成态仍完整"；若视觉不可接受，需向用户确认取舍（见 §12） |

## 12. 与设计 02 的差异与最小待确认问题

未发现与设计 02 的硬冲突。以下工程取值是设计未规定处的最简单可靠选择，若与预期不符可一句话推翻，不需要改产品语义：

1. **收尾小烟花是否发声**：设计未提。本文取"发声"，因为它复用 `world.blasts`（总爆炸数）与现有音效节流；若不想在收尾时听到爆炸声，需要单独标记入队批次。
2. **`#hint` 停留时长与位置**：设计只给文案与"短暂保留"。本文取首次操作后 1.6s 淡出、收尾文案 2.4s 淡出，位置不变。
3. **第十发余下火花的粘附窗口**：设计说"第十次仍正常积累"又说"收尾后新增爆炸只作普通烟花"。本文用"生成瞬间决定 `glue`"消解：第十发的火花在收尾开始后仍可继续粘附，之后的新爆炸与收尾自身的火花都没有资格。
4. **改文案时是否清空天空**：设计只说重置积累与轮数。本文选完整重置（同时清粒子），以避免旧点残影映射到新文本；代价是打字期间夜空被清空。
5. **`#replay` 出现与颜色统一的先后**：设计说落定后颜色过渡 0.6–1s，又说 `settled = 全点落定及之后`。本文取"落定即 `settled`（`#replay` 出现、播报祝福），颜色在随后的 0.8s 内完成"。
6. **完成态 resize 的即时补齐**：设计要求"完成态重排后仍完整"且"不瞬移"。本文在 `settled` 下选择即时补齐（无动画），因为动画面向的是收尾而非重排；若更在意这一帧的观感，需要在"完整性"与"无瞬移"之间明确取舍。

## 13. 本轮交付边界

- 交付：本文档及其对应实现；当前自动化结果和核验改正见 `../review/02-sticky-text-reveal-acceptance.md`。
- 已做：实现 M7–M9 和文档同步；自动化覆盖局部粘附、固定排程、单点补洞、预算、生命周期与视口迁移。
- 未做：`pnpm preview` 人工观察、真机性能测量、视觉调参和正式部署。
- 本文所有时长、半径、比例仍是待视觉验证基线；自动化完成契约与人工视觉验收分开列在 §8.2 / §8.3。
- 下一步：执行 §8.3 人工矩阵，再依据录屏和帧时间集中调参。
