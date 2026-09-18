# ASCII Firework 实现规格：方向化 ASCII 文字（覆盖率网格 + 笔画方向 + Unicode 排版 + 完成态托底）

> 状态：M10–M12 已实施，§10.1 自动化验收通过（54/54，含既有 40 项回归与 DOM 装配冒烟）；§10.2 人工视觉矩阵与 §3 阈值回写待执行。
> 实施与复核记录：`../review/03-directional-ascii-text-acceptance.md`。
> 权威输入：方案讨论结论（覆盖率网格 + 方向 ASCII + `Intl.Segmenter` 排版 + 完成态托底，含 5 项排除项）。
> 体验层仍受 `.agents/design/02-sticky-text-reveal.md`（下称"设计 02"）约束；本文只回答**怎么做、怎么验**。
> 约定：**MUST** 强制 / **SHOULD** 建议 / **MAY** 可选。所有阈值、比例、时长都是**未验证基线**，必须经人工视觉验证后回写。

## 1. 范围与文档关系

在范围：文字目标生成全链路替换（Unicode 分段 → 自动断行 → 高分辨率遮罩 → 单元特征 → 方向化字形映射 →
预算自适应 → 装配）、完成态托底、`ascii-mono` 子集扩充、`world` 文字相关字段。

不在范围：粒子物理、粘附/收尾/迁移/预算机制本身、URL 格式与版本、部署架构、配色、音频、
无第三方运行时依赖的约束。这些保持现状。

| 文档 | 关系 |
| --- | --- |
| `spec/01-ascii-firework-v1.md` | 字体资产节（8 字形子集）由本文 §6 修订为 9 字形；URL、部署、DPR、隐私约束继续有效 |
| `spec/02-sticky-text-reveal.md` | §4.1 采样（`sampleTargets` 网格 alpha 采样）整体替换为本文 §4；§2 数据契约按本文 §2 扩展；粘附/收尾/迁移/渲染层序等其余部分沿用 |
| `spec/03-readable-ascii-text.md` | **全文并入本文后作废**（§2.5 字号=step×1.4 由本文 §4.6 取代；§2.6 低动态 20% 底字由本文 §5 统一托底取代；多行布局与显式换行要求在本文 §4.2 重申）。归档时可删除该文件 |
| `design/02-sticky-text-reveal.md` | 12 项体验决策不变；本文不改动任何体验语义，只改文字目标的生成质量与完成态可读性 |

明确排除（YAGNI，与方案讨论结论一致）：不引入 SVG 采样、字体解析库（opentype.js 类）、自带 CJK
字体资产、骨架化算法、新运行时依赖。骨架化仅在 M13 视觉验收判定细笔画仍断裂时再评估（见 §12）。

## 2. 术语与数据契约

- **单元（cell）**：采样网格单元，矩形 `cellW × cellH`（CSS px），尺寸由字形度量推导（§4.5），不再是正方形扫描步长。
- **遮罩（mask）**：离屏 Canvas 上以 `SUPERSAMPLE` 倍绘制的文字 alpha 位图，是一切特征的唯一事实来源。
- **方向角 θ**：笔画方向角，单位度，定义域 `[0, 180)`，坐标系 y 向下（Canvas 屏幕坐标）。
- **类内随机**：同一字形类别（如内部类 `@`/`*`）内用 `world.rng` 选择，保证同 URL 同设备结果一致。

```ts
/** 采样输出：位置 + 推荐字形。向后兼容 spec 02 的 Point。 */
export interface GlyphTarget extends Point {
  glyph: string; // 单个 ASCII 字符，必须属于 §6 的 9 字形子集
}

/** Target 扩展：槽位携带推荐字形（可选；缺省时粒子保留自身字形，兼容旧测试注入）。 */
export interface Target {
  x: number;
  y: number;
  order: number;
  state: TargetState;
  holder: Particle | null;
  glyph?: string;
}

/** 单元特征：纯函数 cellFeatures 的输出，Node 可测。 */
export interface CellFeatures {
  coverage: number;   // 0..1，alpha 覆盖率
  cx: number;         // 覆盖重心 x（CSS px）
  cy: number;         // 覆盖重心 y（CSS px）
  edge: number;       // 归一化边缘强度 0..1
  coherence: number;  // 方向相干性 0..1（结构张量各向异性）
  angle: number;      // 笔画方向角 deg ∈ [0,180)，y-down
}

/** 排版结果：取代 world.textFontSize + world.textLines。 */
export interface TextLayout {
  lines: string[];    // 视觉行
  size: number;       // 文字字号 px
  lineHeight: number; // size * 1.35
  cellW: number;      // 最终单元宽 px（含预算缩放 k）
  cellH: number;      // 最终单元高 px
  scale: number;      // 实际 k（诊断与调参用）
}
```

`world` 字段变更（最小 diff）：

| 字段 | 变更 | 说明 |
| --- | --- | --- |
| `targets: Target[]` | 元素扩展 `glyph?` | 不变量 1–12 全部沿用（spec 02 §2） |
| `textLayout: TextLayout \| null` | **新增**，替换 `textFontSize` + `textLines` | 排版与单元度量的单一事实来源；结构性重置时置 `null` |
| `textSize` | 保留，来源改变 | = `cellH`（§4.5），不再 `step * 1.4` |
| `step` | 语义改注释 | 改存 `cellH`，仍是捕获半径与迁移容差的尺度基准，公式不变 |
| `settleT` | 复用，不新增计时器 | 托底渐入直接由 `settleT` 驱动（§5） |

MUST NOT：为托底/方向/网格新增任何每帧计时器、每帧分配、常驻 DOM 节点。

## 3. 常量

```ts
const SUPERSAMPLE = 2;        // 遮罩分辨率倍数；内存超限时降为 1（§8）
const MASK_PIXEL_CAP = 6_000_000; // 遮罩像素上限（≈24MB ImageData）
const CELL_DIV = 12;          // baseCell = clamp(size / CELL_DIV, CELL_MIN, CELL_MAX)
const CELL_MIN = 6;           // px：低于此单元字形不可辨（M13 定 7，2026-09 密度决策降至 6）
const CELL_MAX = 10;          // px（M13 定 12，2026-09 密度决策降至 10）
const K_MAX = 2.5;            // 预算自适应的单元放大上限
const BUDGET_SAFETY = 0.9;    // 闭式外推留 10% 余量（覆盖率非严格 ∝ 1/k²）
const MAX_ATTEMPTS = 3;       // 遮罩生成-计数尝试上限
const COVER_MIN = 0.08;       // 低于此覆盖率不产生目标（去噪、去游丝）
const COVER_DENSE = 0.55;     // 高于此判为笔画内部
const EDGE_MIN = 0.15;        // 边缘强度阈值（归一化）
const COH_MIN = 0.5;          // 相干性阈值：低于此判为交叉/转折
const CENTROID_CLAMP = 0.25;  // 重心偏移上限 = 0.25 × cell
const BACKDROP_ALPHA = 0.12;  // 托底不透明度（设计区间 0.1–0.15）
const BACKDROP_FADE = 1.2;    // 托底渐入秒数（复用 settleT）
```

以上全部是待视觉验证基线；`COVER_*` / `EDGE_MIN` / `COH_MIN` / `CELL_DIV` 是 M13 的主要调参面。

> 回写记录（M13 人工矩阵首轮，产品所有者视觉指示）：`CELL_DIV` 7 → 12、`CELL_MAX` 20 → 12。
> 粒子字号 = `cellH = floor(cellW / ratio)` ≈ `size / 7.2`（原 ≈ `size / 4.2`），即 ASCII 字形约缩小 40%、
> 单元数约增 2.9 倍（“增加 ASCII 密度”）。副作用是单元宽与 700 字重笔画宽（≈`0.09em`）同量级：
> 笔画核心的 `coverage` 不再普遍 ≥ `COVER_DENSE`，方向类比重上升，§12 的“满屏 `@`”风险随之降低。
> 长文案仍受 `TEXT_SHARE` 预算约束（`k` 自适配），最终密度由预算而非 `CELL_DIV` 决定。
>
> 回写记录（2026-09，spec 04 的「继续提升单字 ASCII 密度」产品决策）：`CELL_MAX` 12 → 10、
> `CELL_MIN` 7 → 6；配合 spec 04 `PER_GLYPH_BUDGET` 40 → 64 / `TEXT_HARD_CAP` 2400 → 4800。
> 效果：大字号每字格子数 ×1.44（16px 长祝福 ×1.36）；**`CELL_MIN` 6 已触及本文件记录的
> 可辨性下界**，§11/§12 的可辨性矩阵需重测，不足时先回 7 再调 `CELL_DIV`。
> 最终每字密度仍由预算（`PER_GLYPH_BUDGET`）与 `k` 自适配封顶，而非 `CELL_MAX`。

## 4. 生成流水线

流水线只在一个地方接触 DOM：`sampleTargets`（沿用"唯一 DOM 入口"约束，纯逻辑全部可注入测试）。
总顺序 MUST 为：分段 → 断行拟合 → 遮罩 → 单元特征 → 字形映射 → 预算自适应 → 装配。
预算超限时的唯一出路是**回到更大的单元重新完整生成**；MUST NOT 做任何事后抽稀
（stride、随机丢弃、按序截断全部禁止）。

### 4.1 Unicode 分段（`segmentText`，纯函数）

1. 显式 `\n` 切分 MUST 先行且原样保留（作者节奏不可覆盖）。
2. 每个显式段用 `Intl.Segmenter(undefined, { granularity: "grapheme" })` 切字素：
   ZWJ 序列、emoji 修饰符、变体选择符、组合附加符号 MUST 保持原子性。
3. 断行机会用 `Intl.Segmenter(undefined, { granularity: "word" })`：
   词段边界是优先断点；`isWordLike === false` 的段（空白、标点）本身不作为断点内容，
   断在行首时 SHOULD 剔除前导空白段。
4. `Intl.Segmenter` 缺失时（Baseline 2024 之前的环境）MUST 兜底：
   字素退化为 `Array.from()` 码点、断点退化为"ASCII 词边界 + CJK 单字边界"
   （即现 `layoutTextLines` 行为）。一行 `typeof Intl.Segmenter === "undefined"` 判断，不引 polyfill。
5. `scene.ts` 的 60 码点上限与规范化 MUST 不动；截断可能留下残缺字素簇，
   由 canvas 原生渲染为部分图形，接受（不为此改 URL 契约）。

### 4.2 断行与字号拟合（`layoutTextLines` 修订）

沿用 spec 03-readable（已并入）的候选行数策略并修订断点来源：

1. 单行祝福 MUST 同时尝试 1、2、3 行布局，选安全区（`86% × 72%`）内最终字号最大者；
   字号范围 `16–140px`、最多 3 行不变。
2. 断点优先级：word 段边界 > CJK 字素边界 > ASCII 词内（MAY，施加偏好惩罚，同现实现）。
   中文按词段通常给出 1–2 字粒度，断点不足时 SHOULD 叠加字素边界兜底。
3. 宽度度量 MUST 用整行 `measureText`（canvas 原生整形，fallback 链一并生效）；
   MUST NOT 用逐字素宽度求和代替整行测量（整形、kerning、全角空格都会失真，
   见 §9 的 WebKit 全角空格偏差）。SHOULD 缓存候选行测量结果避免重复调用；
   MAY 采用 pretext 式两段法（分段测宽缓存 + 纯算术试排）作为优化。
4. 度量注入签名不变（`measure: (text: string, size: number) => number`），Node 测试用固定度量。

### 4.3 遮罩渲染（`renderTextMask`，DOM 函数）

1. 排版定稿后，用 `document.createElement("canvas")` 建离屏画布，尺寸 = 文字紧凑包围盒
   （`ceil(最大行宽) × ceil(行数 × lineHeight)`，外加 1 个单元的 padding）× `SUPERSAMPLE`。
   MUST NOT 按整个安全区建遮罩（空转像素）。
2. 上下文 MUST 以 `{ willReadFrequently: true }` 创建：本流程每轮尝试都 `getImageData`，
   无此提示时 Chromium 会在两次读回后 GPU→CPU 切换造成同步停顿；有提示时始终保持 CPU 后端，
   单次读回耗时显著下降（tfjs 实测 20ms → 6–10ms 量级）。
3. 绘制：`fillStyle = "#fff"`、`font = 700 ${size * S}px ${TEXT_FONT}`、`textAlign = "left"`、
   `textBaseline = "top"`，逐行按其水平居中偏移 `fillText`。行内整形、CJK/emoji 的
   系统字体 fallback 全部由浏览器完成——这正是"浏览器有字体即正确"约定的实现点。
4. `getImageData` 每轮尝试 MUST 整幅只调一次；alpha 通道即覆盖率质量（未绘制区为 0）。
5. 遮罩像素数超过 `MASK_PIXEL_CAP` 时 MUST 把 `SUPERSAMPLE` 降为 1 重绘（不调排版）。

### 4.4 单元特征提取（`cellFeatures`，纯函数）

输入为遮罩像素数组与单元矩形，输出 `CellFeatures`。全部整数/浮点运算，无 DOM，Node 可测。

1. **覆盖率**：`coverage = Σalpha / (255 × 单元像素数)`；`< COVER_MIN` 直接判空跳过。
2. **重心**：alpha 加权质心，换算回 CSS px；相对单元中心的偏移 MUST 钳制在
   `±CENTROID_CLAMP × cell` 内——目标位置取重心而非格点，消除细笔画偏心缺口。
3. **方向**：对单元块（外延 1px）的 alpha 做 3×3 Sobel 得 `gx, gy`，按**结构张量**聚合：
   `Jxx = Σgx², Jyy = Σgy², Jxy = Σgx·gy`；
   梯度主方向 `Θ = ½ · atan2(2Jxy, Jxx − Jyy)`；
   笔画方向 `θ = (Θ + 90) mod 180`（梯度恒垂直于笔画，必须转换）。
   聚合 MUST 用二倍角/张量形式（方向是 180° 周期的圆变量，直接算术平均会在
   180°↔0° 处回绕出错）；MAY 简化为"单元内梯度幅值最大像素的方向"（ascii-vision 实践）。
4. **边缘强度与相干性**：`edge = Σ|g| / 单元像素数` 归一化；
   `coherence = √((Jxx−Jyy)² + 4Jxy²) / (Jxx+Jyy)`（各向异性；`Jxx+Jyy = 0` 时取 0）。

### 4.5 单元尺寸与字号（几何契约）

等宽字形的横宽比决定单元几何，先把推导钉死：

1. 采样时实测 `ratio = measureText("0", 100).width / 100`（ascii-mono 加载后测量一次即可，
   JetBrains Mono 约 0.6，**实测为准，不写死**）。
2. 基准单元 `baseCell = clamp(size / CELL_DIV, CELL_MIN, CELL_MAX)`；
   预算缩放后 `cellW = ceil(baseCell × k)`，`cellH = ceil(cellW / ratio)`。
3. 粒子字号 `world.textSize = cellH`。横向不重叠由构造保证：
   `advance(textSize) = ratio × cellH = cellW`（取整误差 ≤1px，SHOULD 断言）。
   纵向相邻单元中心距 `cellH` = 字号 em，字形 ink 高 ≈ 0.75em，不重叠。
4. 间距/字号/密度由此解耦：密度只由 `k` 控制，字号永远跟随单元。

### 4.6 字形映射（`pickGlyph`，纯函数）

按单元特征决策，随机性 MUST 只出现在同类内部且只用 `world.rng`：

| 优先级 | 条件 | 字形类 | 类内成员 |
| --- | --- | --- | --- |
| 1 | `coverage ≥ COVER_DENSE` | 内部 | `@` / `*` |
| 2 | `edge ≥ EDGE_MIN` 且 `coherence ≥ COH_MIN` | 方向 | 按 θ 分 bin（下表） |
| 3 | `edge ≥ EDGE_MIN` 且 `coherence < COH_MIN` | 交叉/转折 | `+` |
| 4 | 其余（弱边缘/过渡区） | 点缀 | `.` / `:` |

方向 bin（y-down，中心角 ±22.5°）：

| θ 区间 | 笔画 | 字形 |
| --- | --- | --- |
| `[0, 22.5) ∪ [157.5, 180)` | 横 | `-` |
| `[22.5, 67.5)` | 右下斜 | `\` |
| `[67.5, 112.5)` | 竖 | `|` |
| `[112.5, 157.5)` | 右上斜 | `/` |

类内多成员时用 `world.rng` 等概率选择；单成员类（方向类、`+`）MUST 无随机。

### 4.7 预算自适应（`planCellScale`，纯函数）

1. 预算 `targetBudget = floor(world.cap × TEXT_SHARE)` 不变（`cap` 已含低动态的 `REDUCED_CAP`）。
2. 第一轮 `k = 1` 完整生成并计数 `n`。`n ≤ targetBudget` → 采用。
3. 超限时 SHOULD 用闭式外推直接定价：`k' = clamp(k × √(n / (targetBudget × BUDGET_SAFETY)), 1.05, K_MAX)`，
   回到 §4.3 用 `k'` 重新完整生成（单元像素数 ≈ ∝ 1/k²，覆盖率权重使余量必要）。
4. 仍超 → 重复外推，总尝试 MUST ≤ `MAX_ATTEMPTS`；末次按实测缩放比再放大并把
   `cellW` 向上取整，构造性保证 `≤ targetBudget`。
5. MUST NOT：stride 抽稀、随机丢弃、按扫描序截断、降低 `COVER_MIN` 以外的任何"砍点"捷径。
6. 迁移（`migrate`）MUST 沿用 spec 02 §9：只比例迁移既有目标，不重新采样；
   迁移成功的占据者 SHOULD 同步 `holder.glyph = cand.glyph`（方向类随尺度变化稳定，成本低）。

### 4.8 装配（`sampleTargets` / `applyTargets`）

1. `sampleTargets(world, message): GlyphTarget[]`：跑完 §4.1–§4.7，
   写 `world.textLayout`、`world.textSize`、`world.step = cellH`，返回扫描序目标数组。
   空消息返回 `[]` 并清空 `textLayout`（同现状）。
2. `applyTargets(world, points: Array<Point | GlyphTarget>, step)` 签名向后兼容：
   有 `glyph` 则写入 `Target.glyph`，无则留 `undefined`（既有测试注入路径不受影响）。
   槽位初始化、迁移、桶重建、`fillFree`/`resetSchedule` 触发时机全部沿用 spec 02 §4.1。
3. **绑定即换形**：粒子与目标建立绑定的所有路径 MUST 同步字形——
   捕获（`stepStick` 置 `kind = "text"` 处）、收尾补字（`fillFree` / `fillBatch`）、
   低动就地形（applyTargets 的 reduced 分支）四处，统一 `p.glyph = slot.glyph ?? p.glyph`。
   飞行中火花保持随机字形不变（视觉雪花）；只有成为文字的那一刻才定型。
4. `refreshTargets`、`commitScene` 防抖、字体就绪门槛（`document.fonts.load`）全部不变。

## 5. 渲染整合（`render`）

1. 层序 MUST 为：背景烟花 → **完成态托底** → 文字粒子。（托底取代 spec 03-readable
   的低动态专属 20% 底字，两种动态模式统一为一个机制。）
2. 托底条件：`world.phase === "settled"` 且 `world.textLayout` 非空。
   不透明度：低动态直接 `BACKDROP_ALPHA`；常动态
   `BACKDROP_ALPHA × smoothstep(clamp(settleT / BACKDROP_FADE, 0, 1))`。
   第一版固定透明度，不做质量评分（方案结论 4）。
3. 托底绘制：`font = 700 ${layout.size}px ${TEXT_FONT}`、`fillStyle = palette.glow`、
   `textAlign = "center"`、`textBaseline = "middle"`，逐行按排版行距绘制——
   与采样时同一排版、同一字号、同一行距，保证托底与点阵重合。
4. 文字粒子循环不变：`textSize` 字号、`textColor` 颜色统一、呼吸逻辑全部保留；
   粒子 `glyph` 此时已是槽位推荐字形（§4.8-3）。
5. `#live` 保持 sr-only 辅助文本（spec 03-readable §2.6 后半句仍然有效）。

## 6. ascii-mono 字体子集

1. 字形清单由 8 个扩为 9 个：`* + . : | / \ @` 新增 **`-`**。等宽字体保证 `-` 与其余字形同 advance。
2. 重新生成（开发期一次性，沿用 README 管线）：

   ```bash
   uvx --from fonttools --with brotli pyftsubset JetBrainsMono-Regular.ttf \
     --text='*+.:|/\@-' --flavor=woff2 --layout-features='' --no-hinting --desubroutinize \
     --output-file=public/fonts/ascii-mono.woff2
   ```

3. `style.css` 的 `@font-face`、`main.ts` 的加载门槛（`document.fonts.load` + 1.5s 竞速）不变；
   字体缺失时粒子仍退化到等宽系统字体，接受。
4. README 字体节 MUST 同步字形清单与命令。
5. MUST NOT 引入 CJK 字体资产；祝福文字始终用系统字体栈栅格化。

## 7. 集成点

- `main.ts`：零改动预期（`refreshTargets` 时机、hashchange、resize 迁移全部复用）。
- `scene.ts`：零改动（规范化、60 码点、URL 往返不动）。
- `index.html` / `style.css`：零改动（字体文件原地替换）。
- `fireworks.ts`：改动集中在 `measureContext`/`layoutTextLines`/`sampleTargets`（重写）、
  `applyTargets`（glyph 透传）、捕获/收尾四处绑定点的换形、`render` 托底分支、常量区。
- 现有 40 项测试中纯注入路径（`applyTargets` + `gridPoints`、`layoutTextLines` + 固定度量）
  MUST 保持通过；仅依赖旧 `textFontSize`/`textLines` 字段的断言随字段迁移更新。

## 8. 性能预算

| 项 | 预算 | 机制 |
| --- | --- | --- |
| 遮罩像素 | ≤ `MASK_PIXEL_CAP`（≈6M px ≈ 24MB） | 紧凑包围盒 + 超限降 `SUPERSAMPLE` |
| 一次性生成耗时 | ≤ 50ms 桌面 / ≤ 120ms 中端移动 | 文字排版 + 遮罩 + 特征提取全链路，发生在字体就绪后、结构性重置时 |
| `getImageData` 次数 | ≤ `MAX_ATTEMPTS`（每次尝试一次整幅） | `willReadFrequently` 免 GPU→CPU 同步 |
| 每帧新增分配 | 0 | 决策产物写入 `Target.glyph`；渲染只查表 |
| 每帧新增绘制 | ≤ 3 次 `fillText`，仅 settled | 托底；系统字体，无逐帧测量 |
| Sobel/方向计算 | 0 次/帧 | 全部在一次性生成内 |

resize 走比例迁移不重采样（spec 02 §9 不变）；结构性变更（文案/种子/配色）才重新生成。

## 9. 兼容性与降级

1. **`Intl.Segmenter`**：Baseline 2024（Chrome/Edge 87、Safari 14.1、Firefox 125）。
   MUST 提供 §4.1-4 的码点兜底；Node ≥22 测试环境自带 full-icu，可直接测分段。
2. **系统字体栈**：沿用 `TEXT_FONT`（PingFang SC / Microsoft YaHei / Noto Sans CJK SC /
   system-ui / sans-serif），MUST NOT 删除末端 generic 族——Canvas 按字形走系统级
   fallback，CJK 与 emoji 靠它落到平台字体。栈顺序调整 MAY（如补 `"Noto Sans SC"`）。
3. **tofu 不检测**：Canvas 无可靠的逐字形覆盖检测 API；缺字体时 `.notdef` 方块会被
   照常采样为方向化点阵，布局仍对称可读，接受为边界形态（方案结论 3：
   "浏览器有字体即可正确排版采样"，不追求跨设备像素一致）。
4. **WebKit 全角空格**：`measureText` 与 `fillText` 对 U+3000 宽度可能不一致
   （WebKit bug 108881）→ 测量只用于断点选择，视觉事实一律以遮罩像素为准（§4.3 即兜底）。
5. **emoji**：字素簇原子（§4.1-2）；彩色 emoji 由浏览器渲染进遮罩，按其墨迹正常采样；
   不为其做特殊分支。
6. 同一 URL 在不同设备/字体下点阵不同属预期；跨设备一致性只承诺体验语义（设计 02）。

## 10. 测试与验收

### 10.1 自动化（`node --test`，无框架，DOM 全部注入）

分段与断行：

- §10.1-1 grapheme 不拆 ZWJ emoji（👨‍👩‍👧）、变体选择符、组合附加符；
- §10.1-2 word 段分类与断点：中英混排不在英文词内断（有词边界可选时）；
- §10.1-3 `Intl.Segmenter` 缺失兜底路径与主路径的断点一致性（同输入同布局或显式差异断言）；
- §10.1-4 现有布局断言回归：pangram 三行、短句单行、显式两行保持、≤3 行、字号最大者中选。

单元特征（合成遮罩块注入 `cellFeatures`）：

- §10.1-5 横条/竖条/正斜/反斜合成块 → θ 落在对应 bin（±10° 容差）；
- §10.1-6 十字块 → `coherence < COH_MIN`；实心块 → `coverage ≥ COVER_DENSE` 且 `edge < EDGE_MIN`；
- §10.1-7 偏心细条 → 重心偏移正确且被钳在 `CENTROID_CLAMP` 内；
- §10.1-8 空块 → 不产生目标。

字形映射与预算：

- §10.1-9 `pickGlyph` 决策树四优先级全覆盖；方向类无随机；内部/点缀类随机走注入 rng（确定性可复现）；
- §10.1-10 `planCellScale`：超预算 → k 增大；任意合成输入经 ≤ `MAX_ATTEMPTS` 轮后计数 ≤ 预算；
  输出顺序为连续扫描序（无 stride 缺口的构造性证据）；
- §10.1-11 字号几何：`advance(textSize) ≤ cellW`（构造性断言，用固定 ratio 注入）。

装配与渲染：

- §10.1-12 `applyTargets` 透传 `GlyphTarget.glyph` → `Target.glyph`；旧 `Point[]` 注入兼容；
- §10.1-13 四个绑定点（捕获/收尾两路/低动就地形）换形后 `p.glyph === slot.glyph`；
- §10.1-14 迁移成功槽位的占据者字形同步；迁移失败释放路径不变（spec 02 断言回归）；
- §10.1-15 stub ctx 记录绘制调用：托底在文字粒子之前、alpha 随 `settleT` 渐入且封顶
  `BACKDROP_ALPHA`、低动态直接全量；
- §10.1-16 全部既有烟花/粘附/收尾/预算/URL 测试回归通过；`pnpm build`（tsc + vite）通过。

### 10.2 人工视觉矩阵（自动化不替代观感结论）

| 场景 | 检查点 |
| --- | --- |
| 60 字中文三行（横屏 + 390×844 竖屏） | 横平竖直读得出；撇捺呈 `/` `\`；无规律缺口；不裁切不压控件 |
| 英文 pangram | 斜笔画（A/V/W/y）方向一致；词内不被劈断 |
| emoji + 标点混排 | 簇完整；emoji 区呈实心/点缀类而非碎方向噪声 |
| 完成态 | 托底 alpha 0.1–0.15 渐入、与点阵重合；整句不放大页面可读 |
| 低动态 | 同一托底机制、就地形字形正确 |
| 迁移（旋转屏幕） | 占据点比例迁移、字形跟随、无重采样闪烁 |
| 同 URL 重开 | 类内随机结果一致（`world.rng` 驱动） |
| 双平台抽查 | macOS（PingFang）+ Windows（YaHei）阈值不崩；必要时回写 §3 |

## 11. 里程碑

| 里程碑 | 内容 | 出口标准 |
| --- | --- | --- |
| M10 | `segmentText` + `layoutTextLines` 修订 | §10.1-1～4 通过 |
| M11 | 遮罩 + `cellFeatures` + `pickGlyph` | §10.1-5～9 通过 |
| M12 | `planCellScale` + 装配换形 + 渲染托底 + 字体子集 | §10.1-10～15 通过，构建通过 |
| M13 | 文档同步（README/spec01 修订标记）+ §10.2 人工矩阵 + 阈值回写 | 视觉矩阵结论落档 `../review/` |

## 12. 风险与备选

| 风险 | 应对 |
| --- | --- |
| `COVER_*`/`EDGE_MIN`/`COH_MIN` 跨系统字体不稳 | §10.2 双平台抽查后回写基线；阈值集中 §3 单点可调 |
| 中文词段断点不足导致行宽不均 | 叠加字素边界兜底（§4.2-2） |
| 粗字重下大面积触发 `COVER_DENSE`，满屏 `@` | 调 `COVER_DENSE`；或把方向类优先级提到内部类之前（§4.6 表换序，一处改动） |
| 细笔画在高 `k` 下仍断 | 先调 `CELL_DIV`/`K_MAX`；仍不足才评估骨架化（明确的本轮排除项，升级路径） |
| 遮罩内存峰值超低端机 | `MASK_PIXEL_CAP` 降 `SUPERSAMPLE`；再不行降 `size` 上限（140px）前需重开方案讨论 |

## 13. 调研依据（实施前已核验的外部实践）

| 主题 | 结论 | 来源 |
| --- | --- | --- |
| 方向检测 | 梯度⊥笔画须转换；圆变量不可直接平均，用二倍角/张量或主梯度像素；45° bin 成熟 | github.com/Nikita-Sokolov/ascii-vision（README） |
| Unicode 分段 | `Intl.Segmenter` grapheme/word + `isWordLike`；Baseline 2024；line 粒度未落地，断行为应用层职责 | MDN Intl.Segmenter；web.dev Baseline 2024 |
| Canvas 读回 | `willReadFrequently: true` 保持 CPU 后端，避免 GPU→CPU 同步停顿；Chromium 两次 getImageData 后自动切换反而不可控 | tfjs PR #6445；whatwg/html#5614 |
| 文字排版测量 | 分段测宽缓存 + 纯算术试排（pretext 两段法）；整行测量优先于逐字求和 | github.com/chenglou/pretext（RESEARCH.md） |
| 测量陷阱 | WebKit U+3000 measure/fill 不一致 → 视觉以像素遮罩为准 | WebKit bug 108881 |
| 点阵密度 | 单元面积覆盖率 → 感知密度（halftoning 共识）；重心放置 ≈ 网点 stippling；保笔画靠重采样而非事后抽稀 | 数字半调文献（Pappas 等） |

## 14. 本轮交付边界

> 实施后回填：M10–M12 已按本文落地（差异与验收见 `../review/03-directional-ascii-text-acceptance.md`）；
> M13 的人工矩阵与阈值回写仍未执行。以下为规划期的交付边界原文。

- 交付：本文档（仅规格，无实现）。
- 实现按 M10–M13 推进；每步对应 §10.1 自动化，M13 前不合并视觉结论。
- 本文所有 §3 数值为待验证基线；人工矩阵完成后回写并更新状态行。
- 不追加：SVG 采样、字体解析、CJK 字体资产、骨架化、运行时依赖、可配置密度开关。
