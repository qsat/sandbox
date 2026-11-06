import { describe, expect, test } from "bun:test";
import { run } from "../src/run";

describe("run の timeoutMs", () => {
  test("時間を過ぎたらプロセスを止め、終了コード 124 で返す", async () => {
    const started = Date.now();
    const r = await run("sleep", ["5"], { timeoutMs: 100 });
    expect(r.code).toBe(124);
    expect(r.stderr).toContain("100 ms を過ぎたので止めた");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("時間内に終われば、そのままの終了コードと出力を返す", async () => {
    expect(await run("sh", ["-c", "echo ok"], { timeoutMs: 2000 })).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
  });

  test("timeoutMs を省けば、時間の上限は無い（今までどおり）", async () => {
    expect((await run("sh", ["-c", "exit 3"])).code).toBe(3);
  });
});
