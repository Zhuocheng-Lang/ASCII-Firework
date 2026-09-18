# ASCII Firework 实现规格（Spec v1）

> 状态：可实施。上游设计与产品决策见 `.agents/design/01-product-and-architecture.md`（下称"设计"）。
> 本文只回答 **怎么做、怎么验**，不重新讨论做什么。与设计冲突时以设计为准，并回来更新本文件。
> 约定：**MUST** 强制 / **SHOULD** 建议 / **MAY** 可选。文中"新增"表示设计未列出、由本 spec 补上并给出理由的文件或约束。

## 1. 范围

覆盖：工程脚手架与版本锁定、文件结构、DOM 契约、`scene.ts` 数据契约、`fireworks.ts` 模拟与渲染数值基线、`main.ts` 状态机与输入/音频/分享、样式与字体资产、硬约束、验收命令、实现里程碑。

不覆盖（沿用设计的"明确不实现"）：UI 框架、路由、状态库、CSS 框架、账号/数据库/短链、表演回放、图片视频导出、PWA、WebGL/WebGPU/OffscreenCanvas API、对象池、粒子 ECS、埋点、第三方字体/音频服务。

## 2. 版本与选型（2026-09 事实基线）

| 项 | 采用 | 理由 / 后果 |
| --- | --- | --- |
| Node | `>=22.18`（本机 v26.8.2） | Vite 8 要求 `^20.19 \|\| >=22.12`，wrangler 4 要求 `>=22`；22.18 起原生 TS 类型擦除默认启用 |
| pnpm | `12.4.1`（`packageManager` 锁定） | 设计选定；版本写入 `packageManager` 保证可复现 |
| Vite | `^8.3.0` | Rolldown + Oxc 默认构建链；**不写 `vite.config.ts`**（无插件、无别名、无 `base` 需求） |
| TypeScript | `^7.0.2` | Go 原生编译器；只用于 `tsc --noEmit` 类型检查，产物由 Oxc 擦除类型生成，不经 tsc emit |
| wrangler | `^4.131.1` | 纯静态资产部署，无 `main`、无 binding（已实测 `deploy --dry-run` 退出码 0） |
| @types/node | `^26.5.1` | 仅测试文件需要 `node:test` 类型 |
| 测试 | Node 内置 `node --test` + 原生 TS | **不引入 vitest**：设计只要求一个往返检查，一个测试文件不值得一个框架 |
| Lint/格式化 | 暂无 | typescript-eslint 尚未支持 TS 7 的编译器 API；将来需要时 **SHOULD** 选 oxlint（Rust，不依赖 TS API），而非 typescript-eslint |

### 2.1 这些选择带来的强制约束

1. **源码必须可被类型擦除**：`erasableSyntaxOnly` 开启 ⇒ 不用 `enum`、`namespace`、参数属性、`declare` 之外的语法糖。设计里的"字符串枚举"取**字符串字面量联合**分支。
2. **相对导入写全扩展名**：`import { ... } from './scene.ts'`（`allowImportingTsExtensions` + `noEmit`）。原因：`scene.test.ts` 由 Node 直接执行，Node 的 ESM 解析要求真实文件名；Vite/Rolldown 同样解析该写法。
3. **类型导入必须 `import type`**：`verbatimModuleSyntax` 开启。
4. **`tsc --noEmit` 必须零错误**，因为它同时是"node 能跑这些源码"的静态代理检查。
5. 不依赖 TypeScript 编译器 API 的工具（ts-morph、typedoc、type-aware ESLint）——TS 7 的稳定 API 在 7.1 前不保证。

## 3. 文件结构

```text
.
├── index.html                  # DOM 契约（§5）
├── src/
│   ├── main.ts                 # 生命周期、输入、状态机、音频开关、分享（§8）
│   ├── fireworks.ts            # 粒子模拟、爆炸、揭示目标、Canvas 渲染（§7）
│   ├── scene.ts                # SceneConfig 校验、Fragment 解析与序列化（§6），零 import
│   ├── scene.test.ts           # 新增：设计的"可运行往返检查"，node:test，无框架
│   └── style.css               # 全屏布局、控件、可访问性样式（§9）
├── public/
│   ├── _headers                # 新增：CSP 与安全响应头（§4.4，理由：落实设计的"安全"条目）
│   └── fonts/
│       ├── ascii-mono.woff2    # 本地 ASCII 字形子集（§10）
│       └── OFL.txt             # 新增：字体许可原文（OFL-1.1 要求随文件分发）
├── .gitignore                  # 新增
├── wrangler.jsonc
├── tsconfig.json               # 新增（设计未列出，但工程必须有）
├── package.json
├── pnpm-lock.yaml
└── README.md                   # 仅补 dev/build/test/deploy 命令
```

`src` 只有三个 TS 模块，对应三个真实变化方向（页面流程 / 动画表现 / 持久分享格式）。**MUST NOT** 再拆 renderer、physics、audio service、adapter。

## 4. 可落盘配置

### 4.1 `package.json`

```json
{
  "name": "ascii-firework",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.4.1",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "node --test src/scene.test.ts",
    "check:deploy": "pnpm build && wrangler deploy --dry-run",
    "deploy": "pnpm build && wrangler deploy"
  },
  "devDependencies": {
    "@types/node": "^26.5.1",
    "typescript": "^7.0.2",
    "vite": "^8.3.0",
    "wrangler": "^4.131.1"
  }
}
```

`build` 相对设计建议稿只把 `tsc` 显式写成 `tsc --noEmit`，其他一致。测试脚本显式传入 `src/scene.test.ts`，不依赖不同 Node 版本的自动发现规则。

### 4.2 `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`noUncheckedIndexedAccess` 在热循环里的写法：`const g = GLYPHS[(rng() * GLYPHS.length) | 0] ?? '.'`。不要用 `!` 断言，也不要为了省事关掉该选项。

### 4.3 `wrangler.jsonc`（照设计）

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ascii-firework",
  "compatibility_date": "2026-09-14",
  "assets": {
    "directory": "./dist"
  }
}
```

无 `main`、无 `assets.binding`、无 `not_found_handling`（默认 404 即可，分享走 Fragment 不需要 SPA 回退）。`compatibility_date` 仅在需要新 Workers 兼容行为时更新。

### 4.4 `public/_headers`（新增）

Workers Static Assets 支持资产目录内的 `_headers`（已核实官方文档）。这层是零成本的安全基线，符合设计"不收集、不上传、无第三方请求"：

```text
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: geolocation=(), camera=(), microphone=(), interest-cohort=()
  X-Robots-Tag: noindex

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=86400
```

- CSP 不带 `'unsafe-inline'` ⇒ 标记里 **MUST NOT** 出现 `style="..."` 属性或内联 `<style>`；动态样式只用 `el.style.setProperty()`（CSSOM 路径不受 CSP 限制）。
- `/fonts/*` 不哈希文件名，因此给 1 天而非 1 年缓存。
- 只在真实部署（或 `wrangler dev`）生效；Vite dev/preview 不读 `_headers`。

### 4.5 `.gitignore`

```text
node_modules/
dist/
.wrangler/
.DS_Store
*.local
```

## 5. DOM 契约

### 5.1 `index.html` 骨架

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#050409" />
    <title>ASCII Firework</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="aura" aria-hidden="true"></div>
    <canvas id="sky" aria-hidden="true"></canvas>

    <p id="hint">点击夜空，或按空格发射烟花</p>

    <div id="controls">
      <button id="sound" type="button" aria-pressed="false">声音：关</button>
      <button id="edit" type="button">写下祝福</button>
      <button id="replay" type="button" hidden>重新播放</button>
    </div>

    <p id="live" class="sr-only" aria-live="polite" aria-atomic="true"></p>
    <p id="status" class="sr-only" role="status"></p>

    <dialog id="editor" aria-labelledby="editor-title">
      <form method="dialog">
        <h2 id="editor-title">写下祝福</h2>
        <label for="msg">祝福（最多 3 行、60 字）</label>
        <textarea id="msg" rows="3" autocomplete="off" spellcheck="false"></textarea>
        <p id="counter" class="counter" aria-live="off"></p>

        <fieldset>
          <legend>配色</legend>
          <!-- 4 个 <input type="radio" name="palette" value="rose|amber|aurora|mono"> + <label> -->
        </fieldset>

        <menu>
          <button id="reroll" type="button">换一种绽放</button>
          <button id="share" type="button">分享</button>
          <button value="close">关闭</button>
        </menu>
      </form>
    </dialog>

    <noscript>这个页面需要 JavaScript 才能放烟花。</noscript>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### 5.2 元素契约

| id | 元素 | 职责 | 约束 |
| --- | --- | --- | --- |
| `#aura` | div | 背景径向渐变 + 揭示期提亮 | 纯 CSS，`opacity` 由 JS 通过 CSS 变量调整 |
| `#sky` | canvas | 唯一 Canvas，绘制全部粒子 | `aria-hidden="true"`，不做命中测试 |
| `#hint` | p | 操作提示，首次发射后淡出 | 文案不含祝福内容 |
| `#sound` | button | 声音开关 | `aria-pressed` 与文案「声音：开/关」同步 |
| `#edit` | button | `#editor.showModal()` | 键盘可达 |
| `#replay` | button | 重置场景与计数 | 初始 `hidden`，揭示稳定后显示 |
| `#live` | p | 成字稳定后写入祝福 | 只在 `Message` 状态写一次 |
| `#status` | p | 剪贴板/分享结果播报 | `role="status"` |
| `#editor` | dialog | 原生模态编辑面板 | `showModal()`，Esc 关闭由原生提供 |
| `#msg` | textarea | 祝福输入 | 不用 `maxlength`（按 UTF-16 计数），用 `#counter` + 输入时裁剪 |
| `#counter` | p | 「还可写 N 字 / 第 N 行」 | 纯提示，不打断输入 |
| `#reroll` | button | 重新生成 32 位种子 | `crypto.getRandomValues` |
| `#share` | button | Web Share → Clipboard 兜底 | 见 §8.4 |
| `#share-url` | input readonly（M3 补） | 第三级兜底：承载链接供手动复制 | 初始 `hidden`；只写入 `value`，不用 `innerHTML`；已在 §8.4 要求，此处补入 DOM 契约 |

硬规则：

- 祝福只能写入 `textContent`、表单 `value` 或 Canvas；**MUST NOT** 使用 `innerHTML` / `insertAdjacentHTML` / `setAttribute('style', …)`。
- 页面源码与初始可访问文本 **MUST NOT** 含祝福内容；默认场景文案为空。
- 控件不依赖 Canvas 命中测试；Canvas 不接收焦点。

## 6. 场景数据契约（`scene.ts`）

`scene.ts` **MUST** 零 import、零 DOM 依赖，可被 Node 直接执行。

### 6.1 类型与常量

```ts
export const MAX_CHARS = 60
export const MAX_LINES = 3
export const PALETTE_IDS = ['rose', 'amber', 'aurora', 'mono'] as const
export type PaletteId = (typeof PALETTE_IDS)[number]

export interface Palette {
  id: PaletteId
  label: string          // 编辑器里显示的中文名
  bg1: string            // 径向渐变外圈
  bg2: string            // 径向渐变内圈（更靠近底部光源）
  rocket: string
  sparks: [string, string, string]
  glow: string
}

export interface SceneConfig {
  version: 1
  message: string
  palette: PaletteId
  seed: number           // 无符号 32 位整数：0..4294967295
}

export const PALETTES: Record<PaletteId, Palette>
export const DEFAULT_SCENE: SceneConfig
```

`DEFAULT_SCENE = { version: 1, message: '', palette: 'rose', seed: 240520 }`（空文案表示创建者尚未填写；种子取设计文档示例值，保证"无 Fragment 打开"是稳定画面）。

配色表（**MUST** 照抄；sparks 对背景对比度 ≥ 7:1，`mono` 的 `#a3a3a3` 与 `#050505` 实测约 7.8:1）：

| id | label | bg1 | bg2 | rocket | sparks | glow |
| --- | --- | --- | --- | --- | --- | --- |
| `rose` | 玫瑰 | `#15101c` | `#050409` | `#ffe3ee` | `#ff8fbe` `#ff5f9e` `#ffd0a8` | `#ff3d7f` |
| `amber` | 琥珀 | `#181208` | `#060403` | `#ffeec2` | `#ffc857` `#ff9f1c` `#fff0bf` | `#ff8c2b` |
| `aurora` | 极光 | `#08131a` | `#03060a` | `#d9fff7` | `#5ef2c0` `#7ad7ff` `#c9a7ff` | `#4fd1c5` |
| `mono` | 墨白 | `#141414` | `#050505` | `#f5f5f5` | `#ffffff` `#d4d4d4` `#a3a3a3` | `#e5e5e5` |

### 6.2 导出接口

```ts
export function countCodepoints(s: string): number
export function clampMessage(raw: string): string              // 编辑器输入路径：裁剪而非回退
export function normalizeMessage(raw: string): string          // URL 路径：规范化后判定合法性
export function isValidMessage(s: string): boolean
export function isPaletteId(v: string): v is PaletteId
export function readSceneFromHash(hash: string, fallback?: SceneConfig): SceneConfig
export function writeSceneToHash(scene: SceneConfig): string   // 返回带 '#' 的字符串
export function buildShareUrl(baseUrl: string, scene: SceneConfig): string
```

### 6.3 Fragment 格式

```text
https://example.com/#v=1&m=%E4%B8%BA%E4%BD%A0%E7%9B%9B%E5%BC%80&p=rose&s=240520
```

- 字段顺序固定 `v, m, p, s`；空文案时省略 `m`，任何非空文案（包括“为你盛开”）都写入 `m`；`p`/`s` 恒写出，保证链接可复现。
- 编码：写用 `encodeURIComponent`（空格 → `%20`、字面加号 → `%2B`），读用 `URLSearchParams`（对 `#` 后整串调用，先去掉前导 `#`）。手写的裸 `+` 按 URL 表单编码标准解析为空格；规范写入端不会生成裸 `+`。
- 读路径 **MUST NOT** 直接信任 `URLSearchParams` 的宽松行为，逐字段按下表校验。

### 6.4 校验与回退

| 字段 | 合法输入 | 其他输入 ⇒ |
| --- | --- | --- |
| `v` | 缺省或 `'1'` | **整个场景**回退 `DEFAULT_SCENE`，并忽略其余字段 |
| `m` | 缺省，或规范化后非空、≤60 码点、≤3 行、无控制字符 | 仅 `message` 回退默认空串 |
| `p` | `PALETTE_IDS` 之一 | 仅 `palette` 回退默认值 |
| `s` | `/^\d{1,10}$/` 且 ≤ 4294967295 | 仅 `seed` 回退默认值 |

规范化顺序（`normalizeMessage`）：`\r\n?` → `\n` → 删除除 `\n` 外的 C0/C1 控制字符 → 连续 3 个以上换行折叠为 2 个 → `trim()`。**MUST NOT** 做 Unicode 归一化（NFKC 等会改写用户文字）。

`clampMessage`（编辑器路径）：先规范化，再按码点截断到 60；若超过 3 行，只保留前 3 行。截断按码点（`[...s]`）而非 `s.length`，避免劈开代理对。

### 6.5 往返检查（`src/scene.test.ts`）

用 `node:test` + `node:assert/strict`，**MUST** 覆盖：

1. 中文往返：`'为你盛开'` → `writeSceneToHash` → `readSceneFromHash` 等值。
2. 多行：`'第一行\n第二行\n第三行'` 往返等值；4 行输入按前 3 行裁剪。
3. 特殊字符：空格、`+`、`&`、`#`、`%`、`=`、中文标点往返等值；空格编码为 `%20`，字面加号编码为 `%2B`。
4. 标准解析：手工构造 `#v=1&m=a+b` 解析得到 `'a b'`；由 writer 生成的字面 `'a+b'` 仍往返为 `'a+b'`。
5. 非法字段：`p=neon`、`s=99999999999`、`s=-1`、`v=2`、`m=`（空）各自回退（`v=2` 时整场回退，`m=` 回退空串）。
6. 超长：61 码点与 4 行的 URL 输入 ⇒ `message` 回退默认值，且不抛错。
7. CRLF：`'a\r\nb'` 规范化为 `'a\nb'`。
8. 代理对：含 emoji/组合字符的输入不抛错，`countCodepoints` 与 `[...s].length` 一致。
9. `clampMessage` 幂等 + `write(read(h)) === h`（对规范链接）。

运行：`pnpm test`。**MUST NOT** 为此引入 vitest/playwright 等框架；不为动画与 DOM 写测试（设计已限定范围）。

## 7. 粒子世界契约（`fireworks.ts`）

### 7.1 类型

> **已被取代（2026-09，spec 02 实施后）**：本节与 §7.2 的类型/导出接口由 [spec 02 §3](02-sticky-text-reveal.md) 增补——新增 `Target`/`Batch`/`TargetState` 与 `World` 的粘附字段，**删除 `Particle.targetX/targetY` 与 `REVEAL_DEADLINE`**。以下文本保留为历史记录。

```ts
export type Kind = 'rocket' | 'trail' | 'spark' | 'ember' | 'text'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number          // 剩余秒数
  maxLife: number
  glyph: string
  color: string
  targetX?: number      // 揭示阶段使用（按设计的可选字段）
  targetY?: number
  kind: Kind
  settled?: boolean
  trailT?: number         // M1 补：单枚火箭自己的尾迹累加器（多指并发时各生成各的尾迹）
}

export type Phase = 'loading' | 'playing' | 'revealing' | 'settled'

export interface View { w: number; h: number; dpr: number }

export interface WorldOptions {
  reducedMotion?: boolean
  cap?: number            // 默认 PARTICLE_CAP，reduced motion 时 420
}

export interface World {
  blasts: number          // 由 fireworks.ts 内部递增，main.ts 只读
  /* 其余字段见实现；对外只需下列函数 */
}
```

`Phase` 用字符串字面量联合（不用 `enum`，见 §2.1）。

### 7.2 导出接口

> **已被取代**：见 §7.1 的标注（[spec 02 §3](02-sticky-text-reveal.md)）。

```ts
export const PARTICLE_CAP = 1200
export const GLYPHS = ['.', '*', '+', ':', '*', '.', '/', '\\', '@', '|'] as const
export const REVEAL_DEADLINE = 3.9                                // 揭示硬截止（秒）

export function createRng(seed: number): () => number          // mulberry32 变体，返回 [0,1)
export function createWorld(scene: SceneConfig, view: View, opts?: WorldOptions): World
export function setViewport(world: World, view: View): void     // 归一化位置，重采样揭示目标
export function applyScene(world: World, scene: SceneConfig): void  // 换配色/文字（含稳定后重排）
export function launch(world: World, x: number, y?: number): void
export function update(world: World, dt: number): void          // 内部再夹紧 dt
export function render(ctx: CanvasRenderingContext2D, world: World): void
export function beginReveal(world: World, message: string): void
export function settleReveal(world: World): void                // 立即跳到成字终态（视口变化/硬截止用）
export function resetScene(world: World): void                  // 清空粒子、计数、揭示态，并按种子重建 RNG（重播/换场景用）
export function activeCount(world: World): number
```

`main.ts` 只透过这些函数操作世界，不直接改 `world.particles`。完成爆炸数由 `World` 持有并在内部递增；`main.ts` 只读取只读的 `world.blasts` 来触发状态转换。

### 7.3 帧更新基线

- 循环：`requestAnimationFrame`，`dt = Math.min((now - last) / 1000, 1 / 30)`。变时间步，无固定步长、无插值器（设计已定）。
- 重力 `G = 220 px/s²`；线性阻尼 `v *= Math.exp(-k * dt)`，普通粒子 `k = 1.1`。
- 寿命：spark `1.1–2.2s`（rng），trail `0.35s`，ember `0.8–1.6s`；`life <= 0` 即移除。
- 透明度：`alpha = clamp(life / maxLife, 0, 1)`；`life / maxLife < 0.25` 时 ember 类粒子按帧随机切换字形（闪烁），`prefers-reduced-motion` 下闪烁关闭、alpha 线性衰减。
- 移除与上限：就地压缩（写指针覆盖）过滤死亡粒子；超过 `PARTICLE_CAP` 时按数组顺序先丢最老的 trail/ember/spark 粒子。**rocket 与 text 不参与淘汰**（M1 修正：原表述“先丢最老的非 text 粒子”会让 reduced motion 下同时发射的火箭在到达顶点前被丢掉，实测 40 发齐射时爆炸数为 0；火箭是玩家的一次输入，不该被内存预算吃掉）。粒子数因此可能短暂超过上限，超出部分只有火箭。稳定文字只能由重播或重新应用场景清除。**MUST NOT** 引入对象池（设计明确不实现）。
- 暂停：`document.hidden` 时 `main.ts` 停止 rAF，恢复时把 `last` 重置为当前时间（丢弃时间差），避免物理跳跃。

### 7.4 火箭与爆炸

- 发射点：`x = 指针 x`（键盘发射取 `w/2 + rng()*w*0.16 - w*0.08`），`y = h + 12`。
- 顶点：`apexY = clamp(指针 y ?? h * 0.35, h * 0.15, h * 0.6)`；初速 `vy0 = -Math.sqrt(2 * G * (h - apexY))`，`vx0 = (rng() - 0.5) * 30`。
- 顶点判定：`vy >= -8` ⇒ 转为爆炸：生成 `n = 56 + floor(rng() * 34)` 个 spark（`reducedMotion` 时 × 0.4）。
- 爆炸分布：角度均匀 `2π * i / n` + 抖动 ±8%；速率 `70 + rng() * 160 px/s`；颜色取 `palette.sparks[i % 3]`，8% 概率用 `palette.rocket`；字形随机取 `GLYPHS`。
- 火箭尾迹：每 20ms 累加器生成 1 个 `kind='trail'` 粒子（**最多 50/s**：每帧最多补 1 个，帧率低时按比例减少；不做 `while` 补齐，卡顿帧后不会集中生成粒子）；字形限 `.` `:` `|`，颜色 `palette.glow`，初速继承火箭的 30%。
- 爆炸闪光上限：**MUST NOT** 有整屏叠加式白闪；背景亮化只允许通过 `#aura` 的不透明度变化，揭示期该变化 ≤ 0.12。
- `world.blasts` 在爆炸生成时 +1（不是发射时）。

### 7.5 渲染

- 层序（自下而上）：CSS 背景（`#aura`）→ Canvas 清屏后的 trail/spark/ember（背景烟花）→ `kind === 'text'` 粒子 → HTML 控件。稳定后新烟花天然落在文字后方。
- `render` 只做 `clearRect` + 逐粒子 `fillText`；每帧设置一次 `ctx.font`，`globalAlpha` 与 `fillStyle` 仅在变化时赋值。
- 字形字体栈：`'"ascii-mono", ui-monospace, monospace'`；`textAlign = 'center'`，`textBaseline = 'middle'`。
- 字形尺寸：爆炸粒子 `13px`；文字粒子 `= 采样步长 × 1.05`（见 §7.6）。
- 画布：CSS 尺寸跟随视口，像素尺寸 `Math.round(cssW * dpr)`，`dpr = Math.min(devicePixelRatio, 2)`；绘制前 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`。DPR **MUST** 封顶 2。
- 离屏采样画布用 `document.createElement('canvas')`（普通隐藏元素）。**MUST NOT** 使用 `OffscreenCanvas` API（设计与版本基线都排除）。

### 7.6 揭示算法

> **已被 [spec 02 §4](02-sticky-text-reveal.md) 整体取代（2026-09）**："第七次爆炸后统一回流成字"改为"火花粘附积累 + 第十轮自动收尾 + 完成统一颜色"。本节的时间线、配对与硬截止（`REVEAL_DONE` / `REVEAL_DEADLINE` / `pairTargets` / `settleReveal`）已在实现中删除；采样数学（字号自适应、`step`、stride 抽稀）被复用，但**删除了洗牌与硬截止**，上限改为 `floor(cap * TEXT_SHARE)`。以下文本保留为历史记录，不再作为实现依据。

1. 采样（`sampleTargets(message, view)`）：
   - 按 `view.w * 0.86` 与 `view.h * 0.72` 的安全区，逐行 `measureText` 求放大系数，得栅格化字号 `size = clamp(..., 16, 140)`；行高 `1.35 * size`，整体居中。
   - 采样步长 `step = clamp(size / 8, 5, 16)`，读 `getImageData` 的 alpha > 128 的点，坐标回到 CSS 像素空间。
   - 目标数上限 `targetLimit = Math.floor(cap * 0.7)`（cap = `PARTICLE_CAP`，reduced motion 时 420）。超限时按固定步幅抽稀后再用场景种子洗牌（Fisher–Yates）。
2. 配对：洗牌后的目标点与现存粒子按序配对（`particles[i]` ↔ `targets[i]`），取 `min(两者数量)`。所有已配对粒子立即改为 `kind='text'`、写入目标坐标，并从此停止寿命递减；粒子多于目标点时，多出的粒子转为背景 spark，不参与成字（符合"新烟花在文字后方"的层序）。粒子不足时，从第七次爆炸中心直接补 `kind='text'` 的粒子，颜色 `palette.glow`，同样不参与寿命淘汰。不计算全局最短匹配（设计已定，随机配对产生自然交叉轨迹）。
3. 时间线（`world.revealT` 累积模拟秒，隐藏页自然暂停）：

   | 时间 | 行为 |
   | --- | --- |
   | 0–400ms | 自由扩散：不新增粒子，阻尼不变 |
   | 400–900ms | 停止生成，阻尼升到 `k = 4.2` |
   | 900–2600ms | 吸引：`p = smoothstep((t-0.9)/1.7)`，弹簧 `k_eff = 14p`，阻尼 `c_eff = 1.1 + 6.4p`，扰动振幅 `A = 18(1-p) px/s`（噪声 1.5–3 Hz） |
   | 2600–2900ms | 轻微回弹：`c_eff = 3.2`（允许过冲） |
   | 2900–3200ms | 定形：`c_eff = 9.0`（M2 微调：此段 `k_eff` 取 26 而非 14。设计允许“时长可在实现时微调”；实测 k_eff=14 时最后一批粒子要 4.5s 才吸附，26 后为 3.85s。仍满足过阻尼 `c > 2√k = 10.2`，不震荡） |
   | ≥3200ms | 冻结：`Math.abs(x - targetX) < 0.8` 时直接吸附并标 `settled`，停止该粒子的积分（实测全部吸附在 3.85s，即 `#replay` 在 3.2–3.9s 之间出现） |
   | ≥3900ms | 硬截止（`REVEAL_DEADLINE`）：无论是否满足 0.8px 阈值，一律吸附剩余 `text` 粒子并进入 `settled`，保证稳定时间与辅助技术拿到确定完成时间 |

   `a = (target - pos) * k_eff - v * c_eff + noise`，半隐式欧拉。稳定后文字粒子保留 ±1px、0.4 Hz 的呼吸位移（**整段文字共享同一相位**；逐点独立相位会在小字号下看成抖动），reduced motion 下取消。
4. `prefers-reduced-motion: reduce`：跳过 900–2600ms 的飞行段，改为 800ms 淡入（粒子直接置于目标点，alpha 0→1），随后进入 `settled`；粒子总量上限 420。稳定后 `#live` 在 `@media (prefers-reduced-motion: reduce)` 下从 `.sr-only` 变为居中的可见文字覆盖层（420 上限下的点阵不足以辨认三行 60 字中文）；正常模式保持 `.sr-only`，不提前泄露祝福。
5. 结束信号：`revealT >= 3.2s` 且所有 `text` 粒子 `settled` ⇒ 返回 `settled`；若到 `REVEAL_DEADLINE = 3.9s` 仍有粒子未吸附，则强制吸附后同样返回 `settled`。随后 `main.ts` 写入 `#live`、恢复输入、显示 `#replay`（正常模式 3.2–3.9s，reduced motion 约 0.8s）。

文案为空（`message === ''`）时：不触发成字，第七次爆炸后直接回到 `playing`；分享按钮同时拒绝生成空文案链接（避免用默认祝福冒充发送者的心意）。

### 7.7 视口变化、重播与外部导航

> **已被 [spec 02 §4.9 / §4.10](02-sticky-text-reveal.md) 取代（2026-09）**：视口变化只做等比缩放 + 目标迁移（`refreshTargets`），**不再 `settleReveal()` 立即吸附**；重播与 `hashchange` 的语义不变，但 `revealT` 已拆成 `clock`/`finaleT`/`settleT`。以下文本保留为历史记录。

- `resize`/`orientationchange`：只保留归一化 `(x/w, y/h)`，再乘新尺寸；`#sky` 与离屏画布同步重建。事件用**单个 `requestAnimationFrame` 合并**，且视口尺寸（含 `dpr`）未变化时直接返回，避免 revealing/settled 期重复整屏重采样。
- `revealing` 或 `settled` 期间视口变化：重新采样目标点并 `settleReveal()` 立即吸附（不重跑飞行段），保留字形与颜色。
- `resetScene`：清空粒子数组、`blasts = 0`、`revealT = 0`、相位回 `playing`，并按 `createRng(scene.seed)` 重建 `world.rng`（**重播 = 从种子重新开始**，两次播放的随机结构一致）。
- `hashchange`（外部 Fragment 导航）＝新场景：先“重播级”完整重置（`resetScene()`、`main.ts` 的 `heardBlasts = 0`、两个 RNG 按新种子重建、`#live`/`#replay`/`#aura` 回位），再 `applyScene()`。不继承旧场景的粒子、爆炸计数或揭示态，也不直接揭示新祝福。

## 8. 页面状态机与输入（`main.ts`）

### 8.1 状态转换

> **已被 [spec 02 §5](02-sticky-text-reveal.md) 取代（2026-09）**：删除 `REVEAL_AFTER = 7` 与"揭示期锁定发射"；改为 `world.phase` 为权威、`main.ts` 单向同步（`syncPhase`），轮数阈值 `playerBlasts >= 10`，收尾期与完成后仍可自由发射，并新增 `#bloom` 提前入口。下表保留为历史记录。

| 当前 | 事件 | 目标 | 副作用 |
| --- | --- | --- | --- |
| `loading` | 场景解析完成 + 字体就绪（≤1.5s 超时兜底） | `playing` | 启动 rAF，`#hint` 可见 |
| `playing` | 第 1–6 次爆炸 | `playing` | 更新 `blasts` |
| `playing` | 爆炸数首次跨过 7 且 `message !== ''` | `revealing` | `beginReveal()`，锁定发射，`#aura` 提亮，`#hint` 淡出 |
| `playing` | 爆炸数首次跨过 7 且 `message === ''` | `playing` | 不揭示；继续自由发射（`blasts` 仍会增长） |
| `playing` | 空文案期间首次输入非空文案（无论已放几次） | `playing` | 完整重置（粒子/`blasts`/`heardBlasts`/两个 RNG），第一份祝福必须重新放满七次，不得在编辑器背后揭示。重置发生在 `input` 事件里（`commitScene` 是 200ms 防抖，不能在那里才重置） |
| `revealing` | 成字稳定（含 `REVEAL_DEADLINE` 硬截止） | `settled` | 写 `#live`，恢复输入，显示 `#replay`，`#aura` 回落 |
| `settled` | 发射 | `settled` | 新粒子在文字后方 |
| 任意 | `hashchange`（外部 Fragment 导航） | `playing` | 完整重置 + `applyScene()`，不继承旧场景进度 |
| `settled` | 重新播放 | `playing` | 完整重置（`resetScene()`、`heardBlasts = 0`、按种子重建世界 RNG 与键盘抖动 RNG），隐藏 `#replay` |

转换保持一个小型判别联合 + `switch`，**MUST NOT** 引入状态机依赖。

### 8.2 输入

- `#sky` 上 `pointerdown`（不监听 `pointermove`，不自动连发）：`launch(world, e.clientX, e.clientY)`。多指各自触发各的，不做 `isPrimary` 过滤。
- `document` 上 `keydown`：`Space` / `Enter` 发射；`e.repeat` 忽略；若 `e.target` 命中 `button, input, textarea, select, dialog`（或 `#editor` 打开中）则跳过，避免与控件激活冲突。
- `#sky` 设 `touch-action: none`（**只限画布**：`body` 不设，保留对话框触摸滚动与双指缩放）。
- `revealing` 阶段忽略一切发射输入。

### 8.3 音频（`AudioContext` 只在用户手势中创建/恢复）

- 图：`source → gain(voice) → master(0.22) → destination`；页面打开时**不**创建 context。
- 升空：`OscillatorNode` 正弦，`180 → 720Hz` 线性 `0.18s`，包络 `0 → 0.10 (20ms) → 0 (0.25s)`。
- 爆炸：本地生成的 0.5s 白噪声 `AudioBuffer`（首次需要时生成一次，之后复用），`BiquadFilter` bandpass，中心频率 `700 ± 200Hz`，`Q = 1.2`，包络 `0 → 0.5 (3ms) → 0 (0.45s)`。
- 并发限流：同时最多 4 个爆炸声部；距上次爆炸 < 40ms 时丢弃；主增益固定，避免叠加削波。
- 关闭：只设置 `master.gain = 0`，不主动 `suspend()`，让已调度节点静默结束，避免再次开启时续播旧声音；再次开启时在点击手势里按需 `resume()`，再恢复主增益。不写入 URL、不持久化。

### 8.4 分享与剪贴板

1. 若 `scene.message === ''`，`#status` 写「请先写下祝福」并停止；否则用 `const url = buildShareUrl(location.href, scene)` 生成链接（`URL.hash` 覆盖，不重复追加）。
2. `navigator.canShare?.({ url }) && navigator.share({ url, title: '给你的烟花' })`，`try/catch`；`AbortError`（用户取消）静默忽略，其他错误走第 3 步。
3. 兜底 `navigator.clipboard.writeText(url)` ⇒ `#status` 写「链接已复制」。
4. 再兜底（非安全上下文 / 权限被拒）：在对话框内显示只读 `<input readonly>` 承载链接并 `select()`，提示手动复制。**MUST** 保留此路径——局域网 http 调试下 Web Share 与 Clipboard 都不可用。

### 8.5 编辑器行为

- 打开时：`#msg.value = 当前 message`，若 URL 无 `m` 字段则为空串（让创建者写自己的话）；radio 选中当前配色；`#counter` 显示剩余字数。
- 输入即生效：`input` 事件里 `clampMessage` → 更新 `scene` → `history.replaceState(null, '', hash)`（防抖 200ms）→ `applyScene()`；对话框不因输入关闭。
- IME 与光标：`compositionstart–compositionend` 期间（`composing` 为真）跳过裁剪与提交，组合结束再统一裁剪；发生裁剪时先记录 `selectionStart/selectionEnd`，赋值后用 `setSelectionRange()` 把光标放回原位（只在结尾被裁时才落到末尾）。
- `#reroll`：新种子 `crypto.getRandomValues(new Uint32Array(1))[0]`，立即生效（同一场景风格可复现）。
- 关闭：原生 `method="dialog"`；Focus 回到 `#edit`。

### 8.6 生命周期

- `visibilitychange`：隐藏停 rAF，可见重启并把 `last` 设为 now。
- 首次用户手势后才允许音频；不自动播放，不请求任何权限。
- 不收集、不上传、不持久化祝福（设计硬约束）：无 `fetch`、无 `localStorage`、无第三方请求。

## 9. 样式基线（`style.css`）

- CSS 变量由 JS 按配色写入 `:root`：`--bg-1 --bg-2 --rocket --spark-1 --spark-2 --spark-3 --glow --ui-text --ui-dim --aura-opacity`。
- 布局：`html, body { height: 100dvh; overflow: hidden; }`；`#sky` 用 `position: fixed; inset: 0;`。
- `#controls` 与 `#hint` 用 `env(safe-area-inset-*)` 留边；`#controls` 在窄屏换行不重叠。
- `#aura`：`radial-gradient(120% 80% at 50% 110%, var(--bg-1), var(--bg-2) 60%)`，`opacity` 跟随 `--aura-opacity`（默认 1，揭示期 +0.12，过渡 1.2s）。
- `dialog::backdrop { background: rgba(0,0,0,0.55) }`；`dialog[open]` 内所有控件 16px 以上字号，手机可点按（最小 44×44 CSS 像素）。
- `dialog` 有基于 `100dvh` 与安全区的 `max-height`，并 `overflow-y: auto`：手机横屏等矮视口下内容在对话框内部滚动，关闭/分享/配色控件不会落到可视区外（`body` 不再禁止触摸滚动）。
- `:focus-visible { outline: 2px solid var(--glow); outline-offset: 2px }`；提示文本对 `--bg-2` 对比度 ≥ 4.5:1。
- `.sr-only` 标准裁剪实现；`.counter` 用 `--ui-dim`。
- `@media (prefers-reduced-motion: reduce)`：关闭 `#aura` 过渡与 `#hint` 淡出动画；`#live:not(:empty)` 变为居中的可见文字覆盖层（`white-space: pre-line`、`pointer-events: none`），正常模式不生效。

## 10. 字体资产

- `public/fonts/ascii-mono.woff2` 只包含 Canvas 会用到的 8 个字形：`* + . : | / \ @`。子集化命令（开发期一次性执行，产物入库）：

```bash
uvx --from fonttools pyftsubset JetBrainsMono-Regular.ttf \
  --text='*+.:|/\@' --flavor=woff2 --layout-features='' --no-hinting --desubroutinize \
  --output-file=public/fonts/ascii-mono.woff2
```

- 字体用 **JetBrains Mono**（OFL-1.1）；`public/fonts/OFL.txt` **MUST** 随文件保留许可原文，并在 README 记一行来源。
- `@font-face { font-family: 'ascii-mono'; src: url('/fonts/ascii-mono.woff2') format('woff2'); font-display: block; }`
- 加载门：`loading → playing` 前 `Promise.race([document.fonts.load('13px "ascii-mono"'), delay(1500)])`；超时照常进入 `playing`，避免字体缺失卡住体验。
- 揭示采样的栅格化字体用**系统 CJK 栈**（`'700 <size>px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif'`），不引入中文字体资产。
- 懒人替代（可选，二选一）：删掉字体文件与 `@font-face`，字形字体栈改为 `ui-monospace, "SF Mono", Menlo, Consolas, monospace`；代价是跨设备字形度量有差异，好处是零资产与零许可文件。

## 11. 硬约束清单（实现完成后逐条自查）

- [ ] `PARTICLE_CAP = 1200` 单一全局上限；reduced motion 下 420。
- [ ] `dpr <= 2`，离屏采样画布同规则。
- [ ] 隐藏页停 rAF，恢复不产生物理跳跃。
- [ ] 无 `innerHTML`、无内联 `style` 属性、无 `OffscreenCanvas`、无对象池。
- [ ] 无第三方请求：字体本地、音效程序化生成、无埋点、无 CDN。
- [ ] 祝福只出现在 `textContent` / `value` / Canvas；成字稳定前 `#live` 为空。
- [ ] 所有控件为真实 `<button>`/表单元素，有可访问名称与可见焦点；`Space`/`Enter` 发射与控件激活不冲突。
- [ ] `prefers-reduced-motion: reduce` 下仍能完整获知祝福。
- [ ] 爆炸无整屏白闪；`#aura` 揭示期提亮 ≤ 0.12。
- [ ] 关闭声音后无任何声音；页面加载不创建 `AudioContext`。

## 12. 验证与完成定义

### 12.1 命令

```bash
pnpm install
pnpm test                                     # 往返检查（node --test）
pnpm build                                    # tsc --noEmit + vite build
pnpm preview                                  # 手动矩阵主入口（localhost = 安全上下文）
pnpm check:deploy                             # wrangler deploy --dry-run，应为退出码 0 且列出 dist 文件
pnpm run deploy                               # 构建 + 真部署（**不能**写 `pnpm deploy`：会被 pnpm 内置的 deploy 子命令抢走，报 ERR_PNPM_INVALID_DEPLOY_TARGET）
pnpm dev --host                               # 真机局域网调试（http 非安全上下文，用于验证分享兜底路径）
pnpm build && pnpm exec wrangler dev          # 验证 _headers：curl -sI http://localhost:8787/ | grep -i content-security-policy
```

### 12.2 设计验收标准 → 判定方法

> **与显字相关的行已被取代（2026-09）**："前六次不显示祝福""第七次爆炸触发一次汇聚""揭示期无烟花打断""重放清零（再放 7 次）""空文案后开始输入（重新放满七次）""后台暂停无跳跃""1200 粒子可接受帧率（第 7 次爆炸后）"等条的判定方法改为 [spec 02 §8.3 / §9](02-sticky-text-reveal.md) 的人工矩阵；其余行（URL、DPR、无第三方请求、可访问性、声音）继续有效。

| 设计条目 | 判定 |
| --- | --- |
| 三种输入都能发射 | `pnpm preview`：鼠标点击、触摸（真机或 DevTools 触摸模拟）、`Space`/`Enter` |
| 前六次不显示祝福 | 放 6 次，`#live` 文本为空、无成字 |
| 第七次爆炸触发一次汇聚 | 第 7 次爆炸后进入揭示；`#replay` 在稳定后出现；不重复触发 |
| 揭示期无烟花打断 | 揭示期点击不产生新火箭 |
| 文字稳定后可读、新烟花在后方 | 稳定后连点，文字不被遮挡（层序 §7.5） |
| 重播清零 | 点 `#replay`：粒子清空、计数 0、再放 7 次仍触发；开声音时第二轮仍有爆炸声（`heardBlasts` 已归零） |
| 换链接不继承进度 | 同一标签页内换成另一个分享链接：必须重新放满七次才揭示，`#live` 不提前写入，粒子不继承旧场景 |
| 空文案后开始输入 | 空文案下先放 7 次再输入第一个字：不会在对话框背后揭示，气球清零，需重新放满七次（放 0–6 次再输入同样重置，避免在编辑器背后凑满第 7 次） |
| 输入法边界 | 中文输入法连续输入到 60 字边界不打断组合；裁剪后光标尽量停在原处 |
| 横屏对话框可滚动 | 手机横屏打开对话框：内容可内部滚动，关闭/分享按钮可达；双指缩放不被全局禁用 |
| 中文/空格/换行/标点往返 | `pnpm test` + 一次真链接自测（复制 → 新标签打开） |
| 非法片段不崩 | 手工打开 `#v=2`、`#m=`、`#p=neon`、`#s=abc`、`#s=4294967296` 各一次 |
| 相同链接同主题同种子 | 同链接刷新两次，画面结构一致 |
| 源码/初始可访问文本不含祝福 | 查看源代码 + 初始 `#live` 为空 |
| 不向服务器提交内容 | DevTools Network 除静态资源外无请求 |
| 竖屏/横屏/桌面均可操作 | 三种视口各放 2 次并打开对话框 |
| DPR 缓冲封顶 2 | 控制台：`document.querySelector('#sky').width === Math.round(innerWidth * Math.min(devicePixelRatio, 2))` |
| 后台暂停无跳跃 | 切后台 10s 返回，粒子不瞬移 |
| 1200 粒子可接受帧率 | 第 7 次爆炸后 3s 内用 Performance 面板测均帧时间，目标 ≤ 20ms（记录设备型号） |
| 降低动态效果可获知祝福 | DevTools 渲染面板开启 `prefers-reduced-motion`，仍触发成字且无强闪烁 |
| 打开无声 | 首屏 Network/Media 无音频，`AudioContext` 未创建 |
| 仅手势后创建音频 | 点击 `#sound` 后才有 `AudioContext`；关闭后无声音 |
| 分享不提交 | Web Share 由系统接管；兜底复制不发出请求 |

### 12.3 手动矩阵（照设计展开，逐格打勾）

> **显字行已被取代**：见 [spec 02 §8.3](02-sticky-text-reveal.md) 的粘附/收尾/颜色/迁移矩阵。

| 场景 | 检查 |
| --- | --- |
| 手机触摸 | 发射、横竖屏、安全区不遮挡控件、分享面板、触摸不滚动页面 |
| 桌面鼠标 | 发射、窗口缩放后粒子分布正常、剪贴板兜底文案 |
| 键盘 | Tab 焦点顺序、`Space`/`Enter` 发射、`#sound`、`#replay`、Esc 关对话框后焦点回 `#edit` |
| 降低动态效果 | 无强闪烁、粒子更少、祝福仍能揭示 |
| 无效 Fragment | 安全回退默认场景，控制台无报错 |

### 12.4 记录要求

每完成一个里程碑，在提交描述里写明：跑过的命令、实测设备/浏览器、帧率结果、以及被跳过的检查及原因（例如"未在 iOS Safari 真机验证分享"）。不写"应该没问题"，只写观察到的现象。

## 13. 里程碑（提交边界，jj 一个 change 一个里程碑）

| # | 范围 | 完成信号（可运行检查） |
| --- | --- | --- |
| M0 | 脚手架：`package.json`、`tsconfig.json`、`wrangler.jsonc`、`.gitignore`、`index.html`、`style.css` 变量、`scene.ts` + `scene.test.ts` | `pnpm test` 全绿、`pnpm build` 通过、`pnpm check:deploy` 退出码 0 |
| M1 | `fireworks.ts` 基础：RNG、火箭、爆炸、重力/衰减、DPR、resize、rAF 与暂停；`main.ts` 输入 | 鼠标/触摸/键盘各放 3 次，`#sky` 尺寸计算正确，切后台无跳跃 |
| M2 | 计数与揭示：`blasts`、状态机、采样、配对、时间线、reduced motion、`#replay` | 第 7 次稳定成字、揭示期无新发射、重播清零、二刷仍触发 |
| M3 | 编辑器与分享：dialog、`clampMessage`、配色切换、种子重生成、`replaceState`、Web Share + 两级兜底 | 自测链接往返（含中文/多行）、局域网 http 下兜底输入框出现 |
| M4 | 声音与打磨：音频图、`#sound` 状态、`#live` 时机、`#hint` 淡出、`#aura` 提亮、焦点样式 | §12.2 声音三项 + 键盘矩阵 |
| M5 | 部署与文档：`public/_headers`、字体资产与许可、README 命令、真实 `pnpm run deploy` | `wrangler dev` 下头部正确；线上链接真机跑一遍手动矩阵 |

> **M2 已成为历史（2026-09）**："第七次揭示"由 [spec 02 §10](02-sticky-text-reveal.md) 的 M7–M10 接续；其余里程碑（M0/M1/M3/M4/M5 的产出）继续有效。

## 14. 风险与开放项

| 风险 | 处理 |
| --- | --- |
| 设备缺中日韩字体 ⇒ 揭示点阵变成豆腐点阵 | 仍是"文字轮廓"式点阵，可接受；若实测严重缺失，再考虑采集时用内置少量汉字的点阵表（当前不做） |
| Emoji 不保证形状 | 设计已排除；码点计数仍成立，不崩即可 |
| 分享链接长度：60 汉字编码后约 540 字节 | 链接 < 1KB，聊天软件可接受；不做短链（设计排除） |
| TS 7 生态（lint、编译器 API 工具） | 只用 `tsc --noEmit`；lint 需要时上 oxlint |
| Vite 8 / Rolldown 插件生态成熟度 | 本项目零插件，风险为零；不引入任何 Vite 插件 |
| 字体许可与体积 | 只子集 8 个字形（约 1–3KB）+ 保留 OFL 原文；若嫌麻烦走 §10 懒人替代 |
| 真机帧率不达标 | 先降 `PARTICLE_CAP`（唯一需要调的旋钮），仍不行才考虑设计里的自动画质档位 |

## 15. 升级路径（照设计，附触发信号）

| 扩展 | 触发信号 |
| --- | --- |
| 完整表演回放 | 用户明确需要分享每次发射的位置与节奏 |
| 图片/视频导出 | 聊天平台无法良好传播互动链接 |
| Worker + 数据库 | 需要短链接、公开作品库或排行榜 |
| 自动画质档位 | 目标设备实测频繁低于可接受帧率 |
| WebGL/WebGPU | Canvas 2D 在已优化粒子预算下仍不达标 |
| 多场景路由 | 出现两个以上必须独立访问的页面 |
