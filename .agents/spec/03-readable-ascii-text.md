# ASCII 文字可辨识性修复规格（Spec 03）

> 状态：已实施；自动化核验通过，浏览器视觉复核待完成。
> 范围：修复长祝福缩成单行、ASCII 粒子过小，以及低动态模式的小号文字覆盖问题。其余显字行为沿用 [spec 02](02-sticky-text-reveal.md)。

## 1. Evidence → Finding → Path

| Evidence | Finding | Path |
| --- | --- | --- |
| `helium_screenshot_ascii-firework.2435060515.workers.dev.png` 中 pangram 被压在一条横线上，文字及组成笔画的 ASCII 粒子相对整屏过小 | `sampleTargets` 只识别用户输入中的显式 `\n`；单行越长，拟合字号越小 | `src/fireworks.ts` → `layoutTextLines` → `sampleTargets` |
| 原实现 `world.textSize = step * 1.05` | ASCII 字形未充分占满采样格，符号本身不易辨认 | `sampleTargets` → `world.textSize` → `render` |
| 低动态 CSS 将 `#live` 以最高 `2rem` 盖在 Canvas 上 | 小号实心字遮住 ASCII，同时与 Canvas 排版尺寸不一致 | `syncPhase` → `#live` / `render` |

## 2. 行为契约

1. **单行祝福** MUST 同时尝试 1、2、3 行布局，并选择安全区内最终字号最大的方案。
2. 自动断行 SHOULD 优先落在空格、标点或 CJK 字符边界；连续长单词放不下时 MAY 从词内断开。
3. **显式换行** MUST 原样保留，避免覆盖作者有意安排的节奏和构图。
4. 最终布局 MUST 保持最多 3 行，并继续使用既有 `86% × 72%` 安全区、`16–140px` 字号范围和粒子预算。
5. ASCII 粒子字号 MUST 放大到采样步长的 `1.4` 倍，使等宽字形尽量填满采样格且不横向重叠。
6. 低动态完成态 MUST 在 ASCII 粒子下方绘制同排版、同整体尺寸、`20%` 不透明度的主题色填充；原 `#live` MUST 恢复为仅供辅助技术读取的隐藏文本。
7. URL Fragment、输入上限、配色、动画阶段、字体资产和可访问性播报 MUST 不变。
8. 不新增依赖，不增加常驻 DOM；布局仍在已有离屏 Canvas 采样前完成。

## 3. 实现

- `layoutTextLines(message, safeW, safeH, measure)` 使用当前 Canvas 的 `measureText` 度量候选布局。
- 每个候选行数按目标宽度寻找近似均衡断点，并对 ASCII 单词内部断点施加偏好惩罚。
- `sampleTargets` 使用选中的视觉行重新计算字号与采样步长，将 ASCII 粒子字号设为步长的 `1.4` 倍，并保留排版行与字号。
- `render` 在低动态完成态先绘制 `20%` 不透明度的系统字体填充，再绘制 ASCII 粒子；CSS 不再把 `#live` 显示在 Canvas 上方。

## 4. 验收

### 自动化

运行：

```bash
pnpm test
pnpm build
```

必须满足：

- pangram 在固定度量与视口下布局为三行，且不从英文单词内部断开；
- 短句保持单行；
- 用户显式输入的两行保持两行；
- 低动态完成态的绘制顺序为半透明底字在前、放大 ASCII 在后；
- 原有烟花、粘附、收尾、URL 与预算测试全部通过；
- TypeScript 检查与 Vite 构建通过。

当前结果：`40/40` 测试通过，构建通过。

### 视觉复核

使用截图中的同一 pangram、配色和视口对比修复前后：

- 文字不再横向缩成一条细带；
- 单个 `* + . : | / \\ @` 粒子在稳定文字中可辨认，且相邻采样格不横向重叠；
- 低动态模式下，等大的半透明实心字位于 ASCII 下方，不再出现顶层小字；
- 整句无需放大页面即可阅读；
- 三行均不裁切、不互相覆盖，也不遮挡底部控件；
- 另在约 `390 × 844` 的竖屏视口检查 60 字中文与 60 字英文。

视觉项当前未执行，不以自动化测试代替人工观感结论。

## 5. 非目标

- 不把 Canvas 文字替换成普通 DOM 文本；
- 不改 ASCII 字体或主题颜色；
- 不提高三行与 60 字输入上限；
- 不增加手动字号、行距或断行设置。
