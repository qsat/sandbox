import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeThemeFiles } from "../src";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "claude-theme-files-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const themeFile = (theme: string) => readFile(join(home, ".claude", "themes", `${theme}.json`), "utf8").then(JSON.parse);

test("テーマのフォルダーが無くても作り、dark を元に promptBorder だけを変えたテーマを書く", async () => {
  const theme = await new ClaudeThemeFiles(home).create("#ff0000");
  expect(theme).toMatch(/^ws-[0-9a-f]{8}$/);
  expect(await themeFile(theme)).toEqual({ name: theme, base: "dark", overrides: { promptBorder: "#ff0000" } });
});

test("エージェントごとに別のテーマを作る", async () => {
  const files = new ClaudeThemeFiles(home);
  const [a, b] = [await files.create("#ff0000"), await files.create("#00ff00")];
  expect(a).not.toBe(b);
  expect(await readdir(join(home, ".claude", "themes"))).toHaveLength(2);
});

test("色を変えると、同じテーマのファイルを書き換える", async () => {
  const files = new ClaudeThemeFiles(home);
  const theme = await files.create("#ff0000");
  await files.recolor(theme, "#0000ff");
  expect((await themeFile(theme)).overrides).toEqual({ promptBorder: "#0000ff" });
});
