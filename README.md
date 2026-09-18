# ASCII Firework

一个可分享的全屏网页小游戏：点击、触摸或按 `Space`/`Enter` 发射 ASCII 烟花。
靠近祝福笔画的火花会粘在笔画上，一点一点把句子攒出来；第十轮爆炸之后剩下的缺口
会自动收尾补齐（也可以随时点「让祝福完整绽放」提前收尾），全部落定后颜色统一到主题高亮色。

- 设计：`.agents/design/01-product-and-architecture.md`（产品与架构）、`.agents/design/02-sticky-text-reveal.md`（粘附显字，显字相关冲突时以 02 为准）
- 实现规格：`.agents/spec/01-ascii-firework-v1.md`（URL、部署、字体、音频、DPR 继续有效）、`.agents/spec/02-sticky-text-reveal.md`（显字算法，取代 spec 01 §7.6 / §7.7 / §8.1）
- 祝福、配色和随机种子都保存在 URL Fragment（`#v=1&m=…&p=…&s=…`），没有后端，应用代码不上传祝福，也不写入本地存储。
- 隐私边界：Fragment 不会随 HTTP 请求发给 Cloudflare，也不会进访问日志；但完整链接对聊天平台和收件人可见，它是分享而不是加密存储。

## 开发与部署

```bash
pnpm install
pnpm dev                              # 本地开发
pnpm test                             # node --test：scene 往返 + fireworks 粘附/收尾契约（无框架）
pnpm build                            # tsc --noEmit && vite build
pnpm preview                          # 预览构建产物
pnpm check:deploy                     # 构建 + wrangler deploy --dry-run（应退出码 0）
pnpm exec wrangler login              # 首次部署：授权本机 wrangler（或设 CLOUDFLARE_API_TOKEN）
pnpm run deploy                       # 真部署：构建 + 部署一条命令
pnpm dev --host                       # 局域网真机调试（http 非安全上下文，可验证分享兜底路径）
pnpm build && pnpm exec wrangler dev   # 验证 public/_headers（curl -sI http://localhost:8787/）
```

部署目标见 `wrangler.jsonc`（纯静态资产，无 Worker 脚本），产物目录为 `dist/`。

> 部署只跑 `pnpm run deploy`：它先 `vite build` 再 `wrangler deploy`，不会把旧 `dist` 发上线。
> 不要写成裸的 `pnpm exec wrangler deploy`（不保证是最新构建），也不要写成 `pnpm deploy`
> （会撞上 pnpm 内置的 `deploy` 子命令，报 `ERR_PNPM_INVALID_DEPLOY_TARGET`）。

### 部署后自测（已跑过的线上检查）

```bash
curl -sI https://<你的域名>/ | grep -i content-security-policy
```

线上需确认：CSP 与 `_headers` 其余头生效、字体从本站加载、竖屏/横屏 Canvas 尺寸 =
`Math.round(innerWidth * min(devicePixelRatio, 2))`、放满十轮后自动收尾成字（或点「让祝福完整绽放」
提前收尾）、分享链接往返、控制台无错误。
仍待在真机上补验（见 `.agents/review/01-acceptance-review.md` 与 `02-sticky-text-reveal-acceptance.md`）：
安全区、Web Share 系统面板、iOS/Android 横屏对话框滚动、粘附与收尾的视力观感、帧时间。

## 字体

`public/fonts/ascii-mono.woff2` 是从 **JetBrains Mono 2.304 Regular** 子集化出来的 8 个字形
（`* + . : | / \ @`，896 字节），只用于 Canvas 粒子绘制，避免第三方字体请求。
字体以 OFL-1.1 授权，原文见 `public/fonts/OFL.txt`；来源：<https://github.com/JetBrains/JetBrainsMono>。

重新生成：

```bash
uvx --from fonttools --with brotli pyftsubset JetBrainsMono-Regular.ttf \
  --text='*+.:|/\@' --flavor=woff2 --layout-features='' --no-hinting --desubroutinize \
  --output-file=public/fonts/ascii-mono.woff2
```

祝福文字本身用系统 CJK 栈栅格化成点阵，不引入中文字体资产。
