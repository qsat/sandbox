import { describe, expect, test } from "bun:test";
import { shownError } from "../src/shared/errors";

describe("shownError（mod の下に出す失敗の文）", () => {
  test("操作の失敗は、読み直しが成功しても（読み直しの失敗が空になっても）残る", () => {
    expect(shownError("", "ws: 見つかりません: t9")).toBe("ws: 見つかりません: t9");
  });
  test("操作の失敗が無ければ、読み直しの失敗を出す", () => {
    expect(shownError("ws: hc connect closed", "")).toBe("ws: hc connect closed");
  });
  test("両方あれば、ユーザーがいま行った操作の失敗を先に出す", () => {
    expect(shownError("ws: hc connect closed", "ws: 見つかりません: t9")).toBe("ws: 見つかりません: t9");
  });
  test("どちらも無ければ何も出さない", () => expect(shownError("", "")).toBe(""));
});
