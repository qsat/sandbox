import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HcClient } from "../../src/herdr-core/hc-client";

let dir = "";
function script(name: string, body: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-hc-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("HcClient（hc connect との JSON-RPC）", () => {
  test("hc connect が理由を標準エラーに出して終わったら、その最後の行を失敗の文に添える", async () => {
    const hc = new HcClient(script("down", 'echo "warning: something" >&2\necho "error: herdr-core is not running" >&2\nexit 1'));
    await expect(hc.listIncludingFinished()).rejects.toThrow("hc connect closed: error: herdr-core is not running");
  });

  test("何も言わずに終わったら、切れたことだけを伝える", async () => {
    const hc = new HcClient(script("silent", "exit 0"));
    await expect(hc.listIncludingFinished()).rejects.toThrow(/^hc connect closed$/);
  });

  test("JSON でない行が混ざっても接続を切らず、続く応答を読む", async () => {
    const hc = new HcClient(script("noisy", `read line\necho 'not json'\necho '{"jsonrpc":"2.0","id":1,"result":{"terminals":[]}}'\nread line`));
    expect(await hc.listIncludingFinished()).toEqual([]);
  });

  test("切れたあとの呼び出しは、つなぎ直す", async () => {
    const counter = join(dir, "count");
    const hc = new HcClient(script("once", `echo x >> ${counter}\nread line\necho '{"jsonrpc":"2.0","id":1,"result":{"terminals":[]}}'`));
    expect(await hc.listIncludingFinished()).toEqual([]);
    await Bun.sleep(100);
    expect(await hc.listIncludingFinished()).toEqual([]);
    expect((await Bun.file(counter).text()).trim().split("\n").length).toBe(2);
  });
});
