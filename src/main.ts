import {
  PALETTES,
  buildShareUrl,
  clampMessage,
  countCodepoints,
  isPaletteId,
  readSceneFromHash,
  writeSceneToHash,
} from "./scene.ts";
import type { SceneConfig } from "./scene.ts";
import {
  applyScene,
  createRng,
  createWorld,
  launch,
  refreshTargets,
  render,
  resetScene,
  setViewport,
  startFinale,
  update,
} from "./fireworks.ts";
import type { Phase, View, World } from "./fireworks.ts";

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少元素 ${selector}`);
  return el;
}

function get2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = c.getContext("2d");
  if (!context) throw new Error("Canvas 2D 不可用");
  return context;
}

const canvas = must<HTMLCanvasElement>("#sky");
const hint = must<HTMLElement>("#hint");
const replay = must<HTMLButtonElement>("#replay");
const bloomBtn = must<HTMLButtonElement>("#bloom");
const live = must<HTMLElement>("#live");
const status = must<HTMLElement>("#status");
const editor = must<HTMLDialogElement>("#editor");
const msg = must<HTMLTextAreaElement>("#msg");
const counter = must<HTMLElement>("#counter");
const shareUrl = must<HTMLInputElement>("#share-url");
const ctx = get2d(canvas);

const MAX_CHARS = 60;
/** 提示驻留（秒）：纯粹是 UI 计时器，与模拟时钟无关。 */
const HINT_DWELL = 1.6;
const FINALE_HINT_DWELL = 2.4;
const HINT_IDLE = "把烟花放在不同的地方，看看留下了什么。";
const HINT_FINALE = "还有几束光，正在找它们的位置。";

let scene: SceneConfig = readSceneFromHash(location.hash);

function applyPaletteVars(s: SceneConfig): void {
  const p = PALETTES[s.palette];
  const root = document.documentElement.style;
  root.setProperty("--bg-1", p.bg1);
  root.setProperty("--bg-2", p.bg2);
  root.setProperty("--rocket", p.rocket);
  root.setProperty("--spark-1", p.sparks[0]);
  root.setProperty("--spark-2", p.sparks[1]);
  root.setProperty("--spark-3", p.sparks[2]);
  root.setProperty("--glow", p.glow);
}
applyPaletteVars(scene);

function currentView(): View {
  return {
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
}

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const world: World = createWorld(scene, currentView(), { reducedMotion });
// 场景种子驱动键盘发射的横向抖动；换场景/重播时按种子重建（见 toPlaying）
let jitterRng = createRng(scene.seed ^ 0x9e3779b9);

let resizeQueued = false;
/** 字体就绪前不采样目标：CJK 度量抖动会让首次采样与最终排版不一致。 */
let ready = false;

/** resize/orientationchange 可能连续触发（地址栏、软键盘、旋转），用单帧合并。 */
function scheduleResize(): void {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resize();
  });
}

function resize(force = false): void {
  const view = currentView();
  const prev = world.view;
  // resize 后要重采样整屏目标，尺寸没变就别做（采样是这轮最贵的一步）
  if (!force && view.w === prev.w && view.h === prev.h && view.dpr === prev.dpr)
    return;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  setViewport(world, view);
  // 目标点按新视口重新采样并迁移占据：不提前完成、不清空
  if (ready) refreshTargets(world);
}
resize(true);

/** #aura 提亮上限 0.12（设计硬约束）。 */
function setAura(delta: number): void {
  document.documentElement.style.setProperty(
    "--aura-opacity",
    String(1 + delta),
  );
}

function showReveal(on: boolean): void {
  replay.hidden = !on;
  if (!on) live.textContent = "";
}

let hintTimer = 0;

/** 复位初始提示（重放/新场景）。 */
function resetHint(): void {
  clearTimeout(hintTimer);
  hint.textContent = HINT_IDLE;
  hint.dataset["faded"] = "false";
}

/** 短暂保留后淡出；重复调用只推迟淡出，不会重新亮起。 */
function fadeHintAfter(seconds: number): void {
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    hint.dataset["faded"] = "true";
  }, seconds * 1000);
}

/** 收尾提示：换上文案并重新计时。 */
function showFinaleHint(): void {
  clearTimeout(hintTimer);
  hint.textContent = HINT_FINALE;
  hint.dataset["faded"] = "false";
  fadeHintAfter(FINALE_HINT_DWELL);
}

/** 提前绽放入口只在还能积累时可见。 */
function updateBloom(): void {
  bloomBtn.hidden = !(state === "playing" && scene.message !== "");
}

let state: Phase = "loading";
let raf = 0;
let last = 0;

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  update(world, (now - last) / 1000);
  last = now;
  render(ctx, world);
  if (world.blasts > heardBlasts) {
    heardBlasts = world.blasts;
    playBlast();
  }
  syncPhase();
}

let heardBlasts = 0;

/** 阶段同步：`world.phase` 是权威，main 只做单向上报。 */
function syncPhase(): void {
  if (state !== world.phase) {
    state = world.phase;
    if (state === "revealing") {
      showFinaleHint();
      setAura(0.12);
    } else if (state === "settled") {
      live.textContent = scene.message;
      showReveal(true);
      setAura(0);
    } else {
      live.textContent = "";
      showReveal(false);
      setAura(0);
      if (ready) resetHint();
    }
  }
  updateBloom();
}

function toPlaying(): void {
  resetScene(world);
  heardBlasts = 0; // 不归零的话第二轮只有升空声，没有爆炸声
  jitterRng = createRng(scene.seed ^ 0x9e3779b9);
  state = "playing";
  showReveal(false);
  setAura(0);
  resetHint();
  updateBloom();
}

/** 场景变了：URL、颜色变量、世界一起跟上。 */
function commitScene(next: SceneConfig): void {
  // 与 world 当前场景比：syncMessage 已经立即重置过世界，这里只看是否需要重采样
  const structural =
    next.seed !== world.scene.seed || next.message !== world.scene.message;
  scene = next;
  jitterRng = createRng(scene.seed ^ 0x9e3779b9);
  applyPaletteVars(scene);
  applyScene(world, scene); // 结构性变更：内部完整重置并清空 targets
  if (structural || needsSample) {
    needsSample = false;
    heardBlasts = 0; // blasts 已归零，音效计数也要跟上
    refreshTargets(world);
  }
  history.replaceState(null, "", writeSceneToHash(scene));
  syncPhase();
  updateCounter();
}

let urlTimer = 0;
/** 采样要等防抖：立即重置世界，但全屏采样只在停下来之后做。 */
let needsSample = false;
let composing = false;
function commitSceneDebounced(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => commitScene(scene), 200);
}

function updateCounter(): void {
  const left = MAX_CHARS - countCodepoints(scene.message);
  const lines = scene.message === "" ? 0 : scene.message.split("\n").length;
  counter.textContent = `还可写 ${left} 字 / ${lines} 行`;
}

function start(): void {
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function stop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
}

// ---- 声音（§8.3）：AudioContext 只在用户手势里创建 ----

const sound = must<HTMLButtonElement>("#sound");
const MASTER_GAIN = 0.22;

interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
  voices: number;
  lastBlast: number;
}

let audio: AudioGraph | null = null;
let soundOn = false;

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * 0.5),
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** 只在点击手势里调用；已存在时按需 resume()。 */
function ensureAudio(): void {
  if (!audio) {
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      audio = {
        ctx,
        master,
        noise: makeNoise(ctx),
        voices: 0,
        lastBlast: 0,
      };
    } catch {
      return; // 设备不支持：静默降级
    }
  }
  if (audio.ctx.state === "suspended") void audio.ctx.resume();
}

function playLaunch(): void {
  if (!soundOn || !audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.linearRampToValueAtTime(720, t + 0.18);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
  gain.gain.linearRampToValueAtTime(0, t + 0.25);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.3);
}

function playBlast(): void {
  if (!soundOn || !audio) return;
  const { ctx, master, noise } = audio;
  const now = performance.now();
  if (now - audio.lastBlast < 40 || audio.voices >= 4) return;
  audio.lastBlast = now;
  audio.voices++;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 700 + (Math.random() * 400 - 200);
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5, t + 0.003);
  gain.gain.linearRampToValueAtTime(0, t + 0.45);
  src.connect(filter).connect(gain).connect(master);
  src.onended = () => {
    if (audio) audio.voices--;
  };
  src.start(t);
  src.stop(t + 0.5);
}

sound.addEventListener("click", () => {
  soundOn = !soundOn;
  sound.setAttribute("aria-pressed", String(soundOn));
  sound.textContent = soundOn ? "声音：开" : "声音：关";
  // 关闭只把主增益归零（不 suspend），已调度的节点自然播完
  ensureAudio();
  if (audio) audio.master.gain.value = soundOn ? MASTER_GAIN : 0;
});

function fire(x: number, y?: number): void {
  if (state === "loading") return;
  launch(world, x, y);
  playLaunch();
  fadeHintAfter(HINT_DWELL);
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  fire(e.clientX, e.clientY);
});

document.addEventListener("keydown", (e) => {
  if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
  if (state === "loading") return;
  const target = e.target;
  if (
    target instanceof Element &&
    target.closest("button, input, textarea, select, dialog")
  )
    return;
  if (document.querySelector("#editor[open]")) return;
  e.preventDefault();
  const { w } = world.view;
  fire(w / 2 + jitterRng() * w * 0.16 - w * 0.08);
});

replay.addEventListener("click", toPlaying);

// 提前绽放：与十轮阈值走同一个入口，重复点击是 no-op（幂等）
bloomBtn.addEventListener("click", () => {
  startFinale(world);
  syncPhase();
});

// ---- 编辑器与分享（§8.4 / §8.5）----

must<HTMLButtonElement>("#edit").addEventListener("click", () => {
  msg.value = scene.message;
  for (const radio of dialogPalettes())
    radio.checked = radio.value === scene.palette;
  shareUrl.hidden = true;
  status.textContent = "";
  updateCounter();
  editor.showModal();
});

function dialogPalettes(): HTMLInputElement[] {
  return Array.from(
    editor.querySelectorAll<HTMLInputElement>('input[name="palette"]'),
  );
}

msg.addEventListener("input", () => {
  if (composing) return; // 组合输入期间不裁剪，避免打断输入法
  syncMessage();
});

msg.addEventListener("compositionstart", () => {
  composing = true;
});

msg.addEventListener("compositionend", () => {
  composing = false;
  syncMessage();
});

function syncMessage(): void {
  const clamped = clampMessage(msg.value);
  if (clamped !== msg.value) {
    // 硬上限：只裁掉超出部分，并尽量把光标留在原处（赋值会把光标踢到末尾）
    const start = msg.selectionStart ?? clamped.length;
    const end = msg.selectionEnd ?? start;
    msg.value = clamped;
    const a = Math.min(start, clamped.length);
    const b = Math.min(Math.max(end, a), clamped.length);
    msg.setSelectionRange(a, b);
  }
  if (clamped === scene.message) return;
  // 结构性变更（文案）立即重置世界：否则在编辑器背后会继续攒轮数、甚至触发收尾。
  // 采样是 200ms 防抖里的重活，所以这里只重置、不采样。
  scene = { ...scene, message: clamped };
  applyScene(world, scene);
  needsSample = true;
  syncPhase();
  updateCounter();
  commitSceneDebounced();
}

editor.addEventListener("change", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name !== "palette" || !isPaletteId(target.value)) return;
  commitScene({ ...scene, palette: target.value });
});

must<HTMLButtonElement>("#reroll").addEventListener("click", () => {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  if (seed === undefined) return;
  commitScene({ ...scene, seed });
  status.textContent = "换了一种绽放";
});

must<HTMLButtonElement>("#share").addEventListener("click", () => void share());

async function share(): Promise<void> {
  if (scene.message === "") {
    status.textContent = "请先写下祝福";
    return;
  }
  commitScene(scene); // 先把最新场景写回 URL，再拿 location.href 生成链接
  const url = buildShareUrl(location.href, scene);
  try {
    if (navigator.canShare?.({ url })) {
      await navigator.share({ url, title: "给你的烟花" });
      status.textContent = "已打开系统分享";
      return;
    }
  } catch (err) {
    // 用户取消不算失败，也不再走剪贴板兜底
    if (err instanceof DOMException && err.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = "链接已复制";
    return;
  } catch {
    // 非安全上下文 / 权限被拒：露出只读输入框手动复制
  }
  shareUrl.hidden = false;
  shareUrl.value = url;
  shareUrl.select();
  status.textContent = "请手动复制链接";
}

editor.addEventListener("close", () => {
  must<HTMLButtonElement>("#edit").focus();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stop();
  } else if (state !== "loading") {
    start();
  }
});

window.addEventListener("resize", scheduleResize);
window.addEventListener("orientationchange", scheduleResize);
// 同一标签页里换链接（粘贴/点第二个分享链接）只会触发 fragment 导航，
// 模块不会重新执行；不听 hashchange 的话会继续放上一个链接的祝福。
// 外部导航 = 全新场景：先完整重置，绝不继承旧场景的进度或直接揭示。
window.addEventListener("hashchange", () => {
  toPlaying();
  commitScene(readSceneFromHash(location.hash));
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

try {
  await Promise.race([document.fonts.load('13px "ascii-mono"'), delay(1500)]);
} catch {
  // 字体缺失不阻塞体验
}

// 字体就绪后再采样：顺序是 字体等待 → state = playing → 采样 → start
ready = true;
state = "playing";
world.phase = "playing";
refreshTargets(world);
resetHint();
updateBloom();
start();
