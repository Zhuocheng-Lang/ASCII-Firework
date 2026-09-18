# 方向化 ASCII 文字（spec 03）实施与验收记录

> 范围：`.agents/spec/03-directional-ascii-text.md` 的 M10–M13。
> 结论边界：**§10.1 自动化契约已通过（54/54，含既有 40 项回归）；§10.2 人工视觉矩阵与 §3 阈值回写全部未执行**。
> 本文不把"测试通过"当作视觉验收通过；spec §3 数值仍为待验证基线。
> 设备/浏览器：未启动浏览器、未在真机或桌面观察画面；DOM 相关代码只经过类型检查与构建，未做像素级 smoke。

## 1. 里程碑与命令

| 里程碑 | 改动 | 跑过的命令 | 结果 |
| --- | --- | --- | --- |
| M10 分段与断行 | `src/fireworks.ts`：`hasSegmenter`/`splitGraphemes`/`cutRanks`/`segmentText` 新增，`layoutTextLines` 重写（整行 `measure(text, size)`、断点优先级）；`src/fireworks.test.ts`：§10.1-1～4 | `pnpm test` | 通过 |
| M11 遮罩/特征/字形 | `src/fireworks.ts`：`Mask`/`CellFeatures`/`TextRun` 类型、`cellMetrics`、`cellFeatures`、`directionBin`、`pickGlyph`、`gridTargets`、`planCellScale`、`renderTextMask`/`drawTextMask`/`alphaOf`/`cachedMeasure`；测试 §10.1-5～9 | `pnpm test` | 通过 |
| M12 装配/托底/字体 | `src/fireworks.ts`：`sampleTargets` 重写、`applyTargets` glyph 透传、`migrate` 字形同步、捕获/`bloom`/`fillFree` 三处换形、`render` 统一托底、`World.textLayout` 替换 `textFontSize`+`textLines`；`public/fonts/ascii-mono.woff2` 重新子集化（9 字形）；测试 §10.1-10～15 + DOM 装配冒烟 | `pnpm test`、`pnpm build`、`pyftsubset` + `fontTools` 校验 | 54/54 通过；tsc + vite 通过；字体 912 B，9 字形 advance 全 600/1000 |
| M13 文档同步（部分） | `README.md` 字体节、`spec/01` §7.5/§10 与 `spec/02` §3/§4.1 取代标注、删除 `spec/03-readable-ascii-text.md`、更新 spec 03 状态行、本文件 | 无（纯文档） | — |

- 未运行：`pnpm dev --host`、`pnpm preview`、浏览器/真机视觉观察。
- 交付后按请求执行了部署：`pnpm check:deploy`（dry-run 退出码 0）→ `pnpm run deploy`（上传 3 个新/改资产）。
  线上 smoke：`/` 200 且 CSP 头生效、入口引用新资产哈希 `index-CFg3yPc8.js`、
  `/fonts/ascii-mono.woff2` 200 且 912 B 与本地字节一致、已上线 JS 含 `Segmenter`（新采样路径生效）。
  版本：`e09b96d3-d868-438f-987c-5178562dcb08` @ <https://ascii-firework.2435060515.workers.dev>。
  真机/桌面视觉观察仍未做。
- 未提交任何 jj/git 变更。

## 2. §10.1 自动化契约逐条

| 条目 | 结论 | 证据（`src/fireworks.test.ts`） |
| --- | --- | --- |
| §10.1-1 字素不拆 | ✅ | ZWJ 家庭 emoji、`❤️` 变体选择符、`e\u0301` 组合附加符均为单字素；显式 `\n` 原样保留 |
| §10.1-2 word 分类与断点 | ✅ | `cutRanks("hello 世界") === [0,1,1,1,1,0,0,0,0]`；`"abcdefgh ijkl"` 在空格边界断开而非词内；CJK 词内字素边界仍为 0 |
| §10.1-3 兜底一致性 | ✅ | 同输入主路径/码点兜底断点一致；显式差异断言（emoji 兜底拆 5 码点） |
| §10.1-4 布局回归 | ✅ | pangram 三行、短句单行、显式两行、`measure(text, size)` 线性缩放不改变布局 |
| §10.1-5 方向 bin | ✅ | 横/竖/反斜/正斜合成块 θ 落在对应 bin（≤10° 容差） |
| §10.1-6 cross / solid | ✅ | 十字块 `coherence < COH_MIN`；实心区内部单元 `coverage ≥ COVER_DENSE` 且 `edge < EDGE_MIN` |
| §10.1-7 重心钳制 | ✅ | 偏心细条偏心正确；贴边细条被钳到 `±CENTROID_CLAMP × cell` |
| §10.1-8 空块 | ✅ | `coverage === 0 < COVER_MIN`，`gridTargets` 不产出目标 |
| §10.1-9 pickGlyph 决策树 | ✅ | 四优先级全覆盖；方向类与 `+` 零随机调用；`@`/`*`、`.`/`:` 类内随机；同种子可复现 |
| §10.1-10 planCellScale | ✅ | 超预算 k 增大、`≤ MAX_ATTEMPTS` 轮内落到预算内、预算内直接 k=1；网格输出为连续扫描序 `[(6,6),(18,6),(6,18),(18,18)]` |
| §10.1-11 字号几何 | ✅ | 3 组 ratio × 5 组 cellW：`ratio·cellH ≤ cellW` 且取整误差 `<1px`；整除时可精确相等 |
| §10.1-12 glyph 透传 | ✅ | `GlyphTarget.glyph` 写入 `Target.glyph`；旧 `Point[]` 注入留 `undefined` |
| §10.1-13 四绑定点换形 | ✅ | 捕获（常动 + 低动就地形）、`bloom`（常动 + 低动就地形）、`fillFree` 三路四处均 `p.glyph === slot.glyph` |
| §10.1-14 迁移字形同步 | ✅ | 位置不变、字形改变的迁移后占据者字形同步；释放路径回归不变 |
| §10.1-15 托底 | ✅ | 托底在文字粒子之前；常动态 alpha 随 `settleT` 渐入并封顶 `BACKDROP_ALPHA`；低动态直接全量；字号/行距取自 `textLayout` |
| §10.1-16 全量回归 + 构建 | ✅ | `pnpm test` 54/54（既有 40 项全绿）、`pnpm build`（tsc `--noEmit` + vite）通过 |
| §4.8-1 DOM 装配冒烟（额外） | ✅ | stub canvas 注入下 `refreshTargets` 跑通分段→遮罩→网格→目标：写入 `textLayout`、`step === textSize === cellH`、目标带 `glyph` 且在视口内、扫描序连续；空祝福清空 `textLayout` |

## 3. 实现差异与决策（需 M13 复核）

1. **`cellH` 取 floor 而非 spec §4.5 的 ceil**：`cellW = ceil(baseCell·k)`、`cellH = floor(cellW / ratio)`。
   ceil 下 `advance = ratio·cellH ≥ cellW`，与 §10.1-11 的"`advance ≤ cellW`"直接冲突；floor 是唯一能在整数单元下构造性满足该断言的选择，二者差 `<1px`，只影响亚像素留白，不改变点阵密度。
2. **`edge` 的归一化因子**：取 `Σ|g| / (像素数 × 255)`（以 alpha 满幅为单位的平均梯度），而非 Sobel 理论上界 `255×4`。
   后者会让典型笔画单元的 edge ≈ 0.04，`EDGE_MIN = 0.15` 永不可达（方向类整体失效）；前者使文字边缘落在 `EDGE_MIN` 附近（≈0.05–0.3）。
   **`EDGE_MIN` 与归一化的配对是 M13 的首要调参面**，回写时二者必须一起改。
3. **`CELL_DIV` 与 700 字重的笔画宽度**：该项已在 §3.2 复核改正为 `CELL_DIV = 12 / CELL_MAX = 12`。
   原值 `7 / 20` 下 `baseCell ≈ size/7 ≈ 0.14 em`，而 700 字重笔画约 `0.08–0.1 em`，
   笔画宽度约为单元的 `0.6–0.7`，多数笔画单元会先落入 `coverage ≥ COVER_DENSE` 的内部类，
   `@`/`*` 比重偏高（spec §12 已列该风险）。
4. **断点优先级的落地形态**：词段边界与 CJK 字素边界同为 rank 0，仅 ASCII 词内 rank 1（惩罚 `0.25 × 目标行宽`）。这保持了既有 pangram 断行结果，同时给出 §10.1-2 要求的"有词边界可选时不劈词"。
5. **`ratio` 实测后钳到 `[0.2, 1]`**：字体缺失退化到系统栈时，超出该区间的度量会让 `floor(cellW/ratio)` 失去不重叠保证；钳制只影响异常字体的退化路径。
6. **K_MAX 是预算自适应的硬上界**：k 触顶后 `planCellScale` 停止外推并接受当前点数（禁止 stride 抽稀）。预算极端不足（目标数 > `budget × K_MAX²` 量级）时仍可能超预算，属 spec §4.7-4 未闭合的边界；实机基线里未观察到。
7. **遮罩边界上下文**：`cellFeatures` 对遮罩外一律取 alpha 0，因此贴遮罩边框的单元会人为产生梯度；实际生成里边框是 1 单元 padding（空白），只有合成测试需要把单元放在实心区内，已在 §10.1-6 注明。

### 3.1 复核改正 1：遮罩锚点与托底不重合（截屏回报“字符错位”）

现象：线上完成后 ASCII 点阵整体停在托底真字**上方**（量级约 0.2–0.4em），与 spec §5-3“托底与点阵重合”不符。
根因：两处绘制用了不同的锚点语义——遮罩 `textAlign=left / textBaseline=top` 把行画在**行框顶部**，再居中整个行框；
托底 `center / middle` 居中在视口中心。两者差 `(asc + desc)/2 - lineHeight/2`，随系统字体度量漂移（带正负号不一定）。

修正：

- 新增 `lineOffset(i, count, lineHeight)`，遮罩与托底**共用同一行距公式**；
- `drawTextMask` 改为 `center / middle`，视口中心即遮罩盒中心（盒**对称**包住锚点，尺寸取偶避开半像素），
  纵向留白改用 `fontBoundingBoxAscent/Descent`（实测字体包围盒，缺失才回退 0.9em/0.3em），
  因此重合是**构造性**的，与字体度量无关；
- 新增回归：DOM 冒烟用 stub 墨迹带验证「遮罩 `center/middle`、锚点 = 盒中心、采样重心 ≈ 视口中心」，
  已反向验证：把锚点错开 40px 时该断言失败。

影响：托底绝对位置不变（仍为视口中心、同一行距），移动的是点阵（首次对齐到托底）。

### 3.2 复核改正 2：ASCII 字形变小 / 密度提高（产品所有者视觉指示）

指示：构成文字的 ASCII 要更小、更密（首轮屏幕观感里 “hello” 的字形太大、太稀）。

回写（spec §3 同步）：`CELL_DIV` 7 → 12、`CELL_MAX` 20 → 12；`CELL_MIN` 7 不变。
`cellH = floor(cellW / ratio) ≈ size / 7.2`（原 ≈ `size / 4.2`），即字形约细 40%、单元数约增 2.9 倍。

| 文字字号 | 旧（7/20） | 新（12/12） |
| --- | --- | --- |
| 60px | 9px 单元 / 15px 字形 | 7px 单元 / 11px 字形 |
| 80px | 12px 单元 / 20px 字形 | 7px 单元 / 11px 字形 |
| 100px | 15px 单元 / 25px 字形 | 9px 单元 / 15px 字形 |
| 140px | 20px 单元 / 33px 字形 | 12px 单元 / 20px 字形 |

（`ratio = 0.6`，即 ascii-mono 实测 advance 比；表格由 `cellMetrics` 直接算出。）

副作用与边界：

- 单元宽与 700 字重笔画宽（≈`0.09em`）同量级 → 笔画核心不再普遍 `coverage ≥ COVER_DENSE`，
  方向类比重上升，§3 第 3 条的“满屏 `@`”风险随之降低（`COVER_DENSE` 本轮未动）；
- 长文案仍受 `TEXT_SHARE` 预算约束：`k` 会自适配放大单元到预算内，
  因此**密度的实际提升主要体现在短文案**（预算不绑定时）；长文案的有效密度仍由预算决定；
- `captureR = clamp(cellH × 1.2, 8, 24)` 与迁移容差随 `cellH` 同步变小（公式未变，spec §4.5-3 已预期）；
- 仅改常量，无新增代码路径；`pnpm test` 54/54 与 `pnpm build` 保持通过。

## 4. §10.2 人工视觉矩阵（全部未执行）

| 场景 | 结论 |
| --- | --- |
| 60 字中文三行（横屏 + 390×844 竖屏） | 未观察 |
| 英文 pangram | 未观察 |
| emoji + 标点混排 | 未观察 |
| 完成态（托底 alpha 0.1–0.15、与点阵重合） | 未观察 |
| 低动态 | 未观察 |
| 迁移（旋转屏幕） | 未观察（自动化只覆盖坐标迁移与字形同步，不覆盖闪烁） |
| 同 URL 重开类内随机一致 | 未在浏览器验证（`world.rng` 驱动，注入路径已测确定） |
| 双平台抽查（macOS PingFang / Windows YaHei） | 未观察 |

## 5. 后续待办

- M13 剩余：§10.2 矩阵执行 → §12 风险项择一调参（`EDGE_MIN`/归一化、`COVER_DENSE`、`CELL_DIV`）→ 回写 spec §3 与状态行。
- `pnpm check:deploy` 与线上 HTTP smoke 已跑（结果见 §1）；真机/桌面视觉观察仍未做。
- `world.textLayout` 的 `lines/size/lineHeight` 与采样遮罩共用同一排版源，若 M13 调整字号上限（140px）需同时重跑 §10.1-11 与性能预算（§8 的 ≤50ms/≤120ms 未实测）。
