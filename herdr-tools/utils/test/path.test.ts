import { describe, expect, test } from "bun:test";
import { basename } from "../src/basename";
import { dirname } from "../src/dirname";
import { findContainingPath } from "../src/find-containing-path";
import { isUnderPath } from "../src/is-under-path";
import { trimTrailingSlash } from "../src/trim-trailing-slash";

const API = "/g/o/api";
const FEAT = "/g/o/api=feat-auth";

describe("パス", () => {
  test("trimTrailingSlash（ルートはそのまま）", () => {
    expect(trimTrailingSlash("/a/b//")).toBe("/a/b");
    expect(trimTrailingSlash("/")).toBe("/");
    expect(trimTrailingSlash("a")).toBe("a");
  });
  test("basename / dirname", () => {
    expect(basename(`${FEAT}/`)).toBe("api=feat-auth");
    expect(dirname(`${API}/.git`)).toBe(API);
    expect(dirname("/a")).toBe("/");
    expect(dirname("a")).toBe(".");
  });
  test("isUnderPath は境界で判定（repo と repo=branch を混ぜない）", () => {
    expect(isUnderPath(FEAT, API)).toBe(false);
    expect(isUnderPath(`${API}/src`, API)).toBe(true);
    expect(isUnderPath(API, `${API}/`)).toBe(true);
    expect(isUnderPath("/x", "/")).toBe(true);
  });
  test("findContainingPath は最も深いもの", () => {
    expect(findContainingPath(`${FEAT}/src/x`, [API, FEAT])).toBe(FEAT);
    expect(findContainingPath("/tmp/x", [API])).toBeUndefined();
  });
});
