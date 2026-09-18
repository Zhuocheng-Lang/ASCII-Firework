# 粘附显字（spec 02）实施与验收记录

> 范围：`.agents/spec/02-sticky-text-reveal.md` 的 M7–M10。作者：本轮实现。
> 结论边界：**复核后的自动化契约已通过；全部视觉与真机项仍未验证**。本文不把“测试通过”当作视觉验收通过。
> 设备/浏览器：已启动 `pnpm preview` 做 HTTP 200 与入口文案 smoke check；未部署、未在真机或桌面浏览器观察画面，因此 §2 之外的一切观感判断都不存在。

## 1. 里程碑与命令

| 里程碑 | 改动文件 | 跑过的命令 | 结果 |
| --- | --- | --- | --- |
| M7 目标与积累 | `src/fireworks.ts`（数据契约、`sampleTargets`/`applyTargets`/`refreshTargets`、空间桶、`tryCapture`、`stepStick`、alpha 呼吸、预算比例、`emitSparks`/`explode` 拆分、`playerBlasts`）、`src/main.ts`（删 `REVEAL_AFTER`，`advance` → `syncPhase`，`fire()` 只拦 `loading`，resize 后 `refreshTargets`，字体等待后采样）、`src/fireworks.test.ts`（重写） | `pnpm test`、`pnpm build` | 24/24 通过；build 通过 |
| M8 收尾与完成 | `src/fireworks.ts`（`startFinale`/`planBatches`/`bloom`/`stepFlight`/`stepFinale`/`checkReservations`/`releaseSlot`/`fillFree`、十轮触发、`mixHex`/`textColor`/颜色缓存）、`src/main.ts`（`#bloom`、hint 文案与驻留）、`index.html`（`#bloom` 按钮、`#hint` 文案） | `pnpm test`、`pnpm build` | 32/32 通过；build 通过 |
| M9 生命周期与清理 | `src/fireworks.ts`（迁移时落定粘点贴合新坐标）、`src/main.ts`（`syncMessage` 立即结构性重置 + `needsSample` 防抖重采样、`commitScene` 与 `world.scene` 比较） | `pnpm test`、`pnpm build`、`pnpm check:deploy` | 35/35 通过；build 通过；wrangler dry-run 退出码 0 |
| M10 文档同步 | `README.md`、`.agents/spec/01-ascii-firework-v1.md`（标注被取代条目）、本文件 | 无（纯文档） | — |
| 复核改正 | `src/fireworks.ts`、`src/fireworks.test.ts`、design/spec/review 02 | `pnpm test`、`pnpm build`、`pnpm check:deploy`、preview HTTP smoke | 38/38 通过；build 与 dry-run 通过；preview 返回 HTTP 200 且含提前绽放入口 |

- 未运行：`pnpm dev --host`、`pnpm run deploy`、真机与浏览器视觉观察（preview 仅做 HTTP smoke）。
- 未提交：工作区在本轮开始前已有未提交改动（`README.md`、`package.json`、`src/style.css`、spec/design 文档的改名与新增），本轮没有做任何 jj/git 提交，以免把既有改动归到本轮里程碑名下。

## 2. 自动化已证明的契约

`pnpm test`（`node --test`，无框架、无 DOM）覆盖 spec 02 §8.1 的 19 组主契约，并新增固定排程和单点缺口回归：

- 用例 1–6（`§8.1-1`…`-6`）：槽位初始化与身份顺序、局部捕获与唯一占据、接触半径硬边界（200px 外 3s 永不捕获）、`STICK_TIME` 内落定且位置到位/字形与来源色保留、重复命中不改动已落定粘点、20s 连点与 `cap = 200` 压力下粘点只增不减。
- 用例 7、8、9：轮数与总爆炸数分离（`bloom` 只加 `blasts`）、触发幂等（重复 `startFinale` 不重排、不重复绽放）、零轮提前收尾 120 目标 6s 内补齐；另加"十轮自动触发收尾"一条。
- 用例 10：240 目标挤在角落 → 6s 内补齐；逐帧对已存在粒子断言峰值位移速度 ≤ 900px/s；每颗补字粒子满足 `0 < hypot(fx - tx, fy - ty) <= MAX_FLIGHT`（起点不等于终点 = 无瞬移）。
- 复核回归：仅一个缺口时，补字粒子也从偏移后的可见小烟花飞入；26 个彼此分离、形成超过 12 批的缺口在 4s 内全部落定，防止尾段按剩余队列反复重算导致超时。
- 用例 11：`revealing` 期间每 0.2s 发射一枚，仍在时限内完成、`stuck` 单调不减、队列清空。
- 用例 12：`playing` 内用 glue 火花填满全部目标 → 直接 `settled`，`finaleT === 0`（不经过 `revealing`）。
- 用例 13：`cap = 200` + 12 发连点 → `kind === "text"` 全部保留、非火箭粒子 ≤ cap、被裁的只有 trail/spark/ember。
- 用例 14–16：重置取消旧任务且之后仍能完成、视口迁移不提前完成且粘点落在新坐标（容差内迁移、容差外释放成 0.4s 装饰火花）、完成态重排后仍完整。
- 用例 17：空祝福下 `startFinale` no-op、10 次爆炸后仍 `playing`、无文字粒子。
- 用例 18：`mixHex('#ffffff','#000000',0.5) === 'rgb(128, 128, 128)'`；`settleT = 0` 时解析色 = 来源色、`>= COLOR_FADE` 时 = `palette.glow`；时钟推进 10s 后所有粘点坐标完全不变（呼吸只改 alpha）。
- 用例 19：原有契约继续通过（`createRng` 可复现、上限 1200/420、七发全部爆炸、`resetScene` 归零并按种子重建 RNG、`scene.test.ts` 12 条 URL 契约全绿）。

自动化**不能**证明的项（见 §3）一律未打勾。

## 3. 仍只能人工验证（全部未做）

按 spec 02 §8.3 的矩阵逐格列出，本轮全部为"未观察"：

| 场景 | 状态 |
| --- | --- |
| 开场与首轮（无轮廓/占位点、第一发靠近笔画就留点、远处只放普通烟花） | 未观察 |
| 局部积累（新增粘点集中在爆点附近的笔画） | 未观察 |
| 粘点质感（不漂移、轻微亮度呼吸、被后来烟花穿过时不变） | 未观察 |
| 收尾来源（看得见补字火花从缺口附近飞出、末段减速） | 未观察 |
| 收尾节奏（实际活动时长是否落在 2–4s） | 未观察 |
| 最差落点（十发放角落仍能补齐） | 未观察（仅 240 目标的自动化等价场景通过） |
| 持续连点（收尾中连点不拖慢、不破坏文字） | 未观察 |
| 颜色（来源色 → 0.6–1s 内柔和统一到主题高亮色） | 未观察（只有解析色断言） |
| 提前绽放（零轮与中途点击都从当前状态补齐、连点不重启） | 未观察（幂等与补齐有自动化断言） |
| 长文本与低预算（3 行 × 60 字可读性） | 未观察 |
| reduced motion（无大幅运动、短淡入、`#live` 可见兜底） | 未观察 |
| 视口（积累中/收尾中旋转屏幕） | 未观察 |
| 生命周期（重放、改文案、换配色、换链接、换种子、切后台 10s） | 未观察 |
| 性能（正常/低动态两档帧时间） | 未测量 |
| 可访问性（收尾中键盘发射、完成时才播报祝福） | 未观察 |

## 4. M10 调参状态：**未做，且不应在无观察的情况下做**

spec 02 §3.2 标注“待视觉验证”的取值（`GLUE_SHARE`、`CAPTURE_MIN/MAX`、`STICK_TIME`、`FINALE_*`、`BATCH_CELL`、`FILLER_SWAY_MAX`、`COLOR_FADE`、`BREATH_*`、`MIGRATE_TOL`）仍未做视觉调参。复核新增 `BLOOM_OFFSET = 24px`，只用于修复单点缺口在终点生成的语义错误，不宣称该数值已经视觉调优。其余调参需要录屏或真机观察；在没有观察的情况下改动只会把“未验证”伪装成“已调好”。

## 5. 与 spec 02 的实现差异（工程取值，均可一句话推翻）

1. **`sampleTargets` 顺带写 `world.step`**：签名保持规格的 `{ x, y }[]`，采样步长由采样函数写入 `world`，`refreshTargets` 再显式传给纯函数 `applyTargets(world, points, step)`，避免把排版数学复制一份。
2. **固定波次字段已补回**：复核证明按剩余队列重算并不与“收尾开始时算一次”等价——12 批约需 6s、100 批约需 10s 才排完。`World.batchSize` / `batchInterval` 现于 `resetSchedule` 固定计算；只有 resize 或预留失效重排时才重算。
3. **`checkReservations` 用粒子自己的计时当预留年龄**：预留时间就是 `flightT` 或 `stickT`（互斥），因此不需要额外字段；`world.reserved === 0` 时直接返回，仅在 `revealing` 分支逐帧扫描（规格写"每 0.5s 一次"，逐帧更早释放且成本可忽略）。
4. **视口迁移先统一坐标系**：`setViewport` 同比缩放粒子、飞行起点和旧目标并重建 AABB/空间桶；`migrate` 再把占据映射到新采样目标，并让已落定粘点贴合新坐标。旧目标不缩放会把横竖屏后的正常位置变化误判为超出容差。
5. **`planBatches` 同时约束数量、距离和起点**：过大或偏斜的单元格沿长轴递归二分到 `BATCH_MAX` 与距离上限内；绽放点偏离质心 `BLOOM_OFFSET`，合并只允许质心最大距离 `<= MAX_FLIGHT - BLOOM_OFFSET`。
6. **`commitScene` 与 `world.scene` 比较并带 `needsSample` 标记**：§5.4 要求"文案一变就同步重置、防抖才重采样"，而 `syncMessage` 里的立即 `applyScene` 已经把结构性差异消化掉；用标记把"还需要采样一次"传给防抖回调，同时把 `heardBlasts` 归零（`blasts` 已归零，否则新场景只有升空声）。
7. **`#hint` 在回到 `playing` 时复位初始文案**：规格只说"重放/新场景复位"，实现把 `playing` 分支也覆盖到（重放、改文案、换链接都走它）。

## 6. 与 spec 02 / design 02 的冲突

复核发现并改正了三处实现冲突：固定活动窗口被动态重算破坏、视口迁移使用不同坐标系、单点缺口直接在终点生成。修正后未发现其余可由自动化证明的冲突；design 02 的 12 项产品决策未改动。视觉语义仍需通过 §3 的浏览器人工矩阵确认。

## 7. 下一步

1. `pnpm preview` 走一遍 §3 的全部格子，逐格记录现象与设备/浏览器（spec 02 §8.3）。
2. 在至少一台真机上记录：最长文本 + 收尾 + 连点时的帧时间，以及一次 `getImageData` 采样耗时。
3. 依据观察结果集中调 §3.2 的待验证数值，并把观察依据写进提交描述。
