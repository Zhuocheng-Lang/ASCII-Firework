import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCENE,
  MAX_CHARS,
  MAX_LINES,
  PALETTES,
  buildShareUrl,
  clampMessage,
  countCodepoints,
  isPaletteId,
  isValidMessage,
  normalizeMessage,
  readSceneFromHash,
  writeSceneToHash,
} from "./scene.ts";
import type { SceneConfig } from "./scene.ts";

const scene = (patch: Partial<SceneConfig> = {}): SceneConfig => ({
  ...DEFAULT_SCENE,
  ...patch,
});
const roundTrip = (message: string): string =>
  readSceneFromHash(writeSceneToHash(scene({ message }))).message;

test("中文往返", () => {
  const h = writeSceneToHash(scene({ message: "为你盛开" }));
  assert.deepEqual(readSceneFromHash(h), scene({ message: "为你盛开" }));
  assert.ok(h.includes("m=%E4%B8%BA%E4%BD%A0%E7%9B%9B%E5%BC%80"));
});

test("多行往返，超过 MAX_LINES 的行被裁剪", () => {
  const eight = ["一", "二", "三", "四", "五", "六", "七", "八"].join("\n");
  assert.equal(eight.split("\n").length, MAX_LINES);
  assert.equal(roundTrip(eight), eight);
  assert.equal(clampMessage(eight + "\n九"), eight);
  assert.equal(roundTrip(eight + "\n九"), "");
  assert.equal(
    readSceneFromHash(`#v=1&m=${encodeURIComponent(eight + "\n九")}`).message,
    "",
  );
});

test("特殊字符往返，空格与加号按规范编码", () => {
  const raw = " 空格 +& # % = ，。！ ";
  const canonical = "空格 +& # % = ，。！";
  const h = writeSceneToHash(scene({ message: canonical }));
  assert.ok(h.includes("%20%2B%26%20%23%20%25%20%3D%20"));
  assert.equal(roundTrip(canonical), canonical);
  assert.equal(clampMessage(raw), canonical);
});

test("标准解析：裸加号为空格，writer 的字面加号为加号", () => {
  assert.equal(readSceneFromHash("#v=1&m=a+b").message, "a b");
  assert.equal(roundTrip("a+b"), "a+b");
  assert.ok(writeSceneToHash(scene({ message: "a+b" })).includes("m=a%2Bb"));
});

test("非法字段逐字段回退", () => {
  assert.deepEqual(
    readSceneFromHash("#v=1&p=neon"),
    scene({ palette: "rose" }),
  );
  assert.equal(
    readSceneFromHash("#v=1&s=99999999999").seed,
    DEFAULT_SCENE.seed,
  );
  assert.equal(readSceneFromHash("#v=1&s=-1").seed, DEFAULT_SCENE.seed);
  assert.equal(readSceneFromHash("#v=1&s=abc").seed, DEFAULT_SCENE.seed);
  assert.equal(readSceneFromHash("#v=1&s=4294967296").seed, DEFAULT_SCENE.seed);
  assert.equal(readSceneFromHash("#v=1&s=4294967295").seed, 4294967295);
  assert.deepEqual(
    readSceneFromHash("#v=2&m=%E4%BD%A0&p=mono&s=1"),
    DEFAULT_SCENE,
  );
  assert.equal(readSceneFromHash("#v=1&m=").message, "");
  assert.equal(readSceneFromHash("").message, "");
  assert.equal(isPaletteId("mono"), true);
  assert.equal(isPaletteId("Mono"), false);
});

test("超长 URL 输入回退，不抛错；旧版 60 字链接依旧合法", () => {
  const long = "字".repeat(MAX_CHARS + 1);
  assert.doesNotThrow(() =>
    readSceneFromHash(`#v=1&m=${encodeURIComponent(long)}`),
  );
  assert.equal(
    readSceneFromHash(`#v=1&m=${encodeURIComponent(long)}`).message,
    "",
  );
  assert.equal(
    readSceneFromHash(`#v=1&m=${encodeURIComponent("一\n二\n三\n四")}`)
      .message,
    "一\n二\n三\n四",
  );
  assert.equal(countCodepoints(long), MAX_CHARS + 1);
  // spec 04 §3.1：旧版（≤60 字、≤3 行）链接在新版完全等价
  const legacy = "字".repeat(60);
  assert.equal(isValidMessage(legacy), true);
  assert.equal(roundTrip(legacy), legacy);
  assert.equal(
    readSceneFromHash(`#v=1&m=${encodeURIComponent(legacy)}`).message,
    legacy,
  );
});

test("isValidMessage 按 MAX_CHARS 与 MAX_LINES 判定", () => {
  assert.equal(MAX_CHARS, 200);
  assert.equal(MAX_LINES, 8);
  assert.equal(isValidMessage("字".repeat(MAX_CHARS)), true);
  assert.equal(isValidMessage("字".repeat(MAX_CHARS + 1)), false);
  assert.equal(isValidMessage([...Array(MAX_LINES)].map(() => "行").join("\n")), true);
  assert.equal(
    isValidMessage([...Array(MAX_LINES + 1)].map(() => "行").join("\n")),
    false,
  );
  assert.equal(isValidMessage(""), false);
  assert.equal(isValidMessage(" a"), false); // 非规范化（首部空白）
});

test("CRLF 规范化为 LF", () => {
  assert.equal(normalizeMessage("a\r\nb"), "a\nb");
  assert.equal(normalizeMessage("a\rb"), "a\nb");
  assert.equal(roundTrip("a\r\nb"), "a\nb");
});

test("代理对与组合字符", () => {
  const s = "👩‍❤️‍💋‍👨 家族 🇨🇳 é";
  assert.equal(countCodepoints(s), [...s].length);
  assert.equal(roundTrip("🎆"), "🎆");
  assert.doesNotThrow(() => clampMessage(s));
  assert.doesNotThrow(() =>
    readSceneFromHash(`#v=1&m=${encodeURIComponent(s)}`),
  );
});

test("clampMessage 幂等且按码点截断", () => {
  assert.equal(clampMessage("🎆".repeat(MAX_CHARS + 1)), "🎆".repeat(MAX_CHARS));
  assert.equal(
    countCodepoints(clampMessage("🎆".repeat(MAX_CHARS + 1))),
    MAX_CHARS,
  );
  assert.equal(countCodepoints(clampMessage("字".repeat(300))), MAX_CHARS);
  assert.equal(
    clampMessage([...Array(MAX_LINES + 1)].map(() => "行").join("\n")),
    [...Array(MAX_LINES)].map(() => "行").join("\n"),
  );
  const inputs = [
    "  ",
    "a\n\n\n\nb",
    "字".repeat(80),
    "一\n二\n三\n四",
    [...Array(MAX_LINES + 2)].map(() => "行").join("\n"),
    "x\r\ny",
    "🎆🎇",
  ];
  for (const raw of inputs) {
    const once = clampMessage(raw);
    assert.equal(clampMessage(once), once, JSON.stringify(raw));
  }
});

test("规范链接写入即幂等，且省略空文案、恒写 p/s", () => {
  const h = "#v=1&m=%E4%B8%BA%E4%BD%A0&p=aurora&s=42";
  assert.equal(writeSceneToHash(readSceneFromHash(h)), h);
  const empty = writeSceneToHash(scene());
  assert.equal(empty, "#v=1&p=rose&s=240520");
  assert.equal(writeSceneToHash(readSceneFromHash(empty)), empty);
});

test("buildShareUrl 覆盖已有 Fragment", () => {
  const url = buildShareUrl(
    "https://x.dev/#v=2&m=old",
    scene({ message: "好", palette: "amber" }),
  );
  assert.equal(
    url,
    `https://x.dev/#v=1&m=${encodeURIComponent("好")}&p=amber&s=240520`,
  );
  assert.equal(
    new URL(url).hash,
    writeSceneToHash(scene({ message: "好", palette: "amber" })),
  );
});

test("配色表完整", () => {
  for (const id of ["rose", "amber", "aurora", "mono"] as const) {
    assert.equal(PALETTES[id].id, id);
    assert.equal(PALETTES[id].sparks.length, 3);
    assert.match(PALETTES[id].glow, /^#[0-9a-f]{6}$/);
  }
});
