import { expect, test } from "bun:test";
import { repoName } from "../repoName.ts";

test("repoName: ghq root からの相対名", () => {
  expect(repoName("/g/github.com/acme/api", ["/g"])).toBe("github.com/acme/api");
  expect(repoName("/elsewhere/api", ["/g"])).toBe("/elsewhere/api");
});
