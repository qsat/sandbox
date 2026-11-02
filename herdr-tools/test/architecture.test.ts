import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|js)$/.test(name)) out.push(p);
  }
  return out;
}

function imports(src: string): string[] {
  const re = /(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2]!);
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const BUILTIN = /^(node:|bun$|bun:)/;

function check(pkg: string, allowed: string[]) {
  const bad: string[] = [];
  for (const f of files(join(ROOT, pkg, "src"))) {
    for (const spec of imports(readFileSync(f, "utf8"))) {
      if (spec.startsWith(".") || BUILTIN.test(spec)) continue;
      if (!allowed.some((a) => (a.endsWith("/*") ? spec.startsWith(a.slice(0, -1)) : spec === a))) bad.push(`${relative(ROOT, f)}: ${spec}`);
    }
  }
  return bad;
}

function codeHits(dir: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const f of files(dir))
    stripComments(readFileSync(f, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
  return hits;
}

const UTILS = "@herdr-tools/utils/*";

describe("依存の向き（ws → ws-core / tmux、tmux → ws-core、herdr-app → I/O の無いモジュール、全員 → utils）", () => {
  test("utils はどこにも依存しない", () => expect(check("utils", [])).toEqual([]));
  test("ws-core は utils だけ", () => expect(check("ws-core", [UTILS])).toEqual([]));
  test("tmux は ws-core と utils だけ", () => expect(check("tmux", ["@herdr-tools/ws-core", "@herdr-tools/ws-core/domain/tree", "@herdr-tools/ws-core/domain/usage", UTILS])).toEqual([]));
  test("herdr-app は I/O の無いモジュール（ws-core のモデル・Terminal の型、ws list --json の型）と utils、Herdr app の API だけ", () =>
    expect(
      check("herdr-app", ["@herdr-tools/ws-core/domain/agent", "@herdr-tools/ws-core/herdr-core/hc-terminal", "@herdr-tools/tmux/list-json", UTILS, "herdr", "gpui-kit"]),
    ).toEqual([]));

  test("ws-core のコードにクライアント（tmux / Herdr app）が出てこない", () => {
    expect(codeHits(join(ROOT, "ws-core", "src"), /tmux|herdr-app|gpui|agent-board/i)).toEqual([]);
  });

  test("tmux のコードは herdr-core（hc）を直接触らない", () => {
    expect(codeHits(join(ROOT, "tmux", "src"), /\bhc\b|HC_|herdr(?!-tools)|HerdrRuntime/i)).toEqual([]);
  });

  test("utils は1ファイル1関数（型だけのファイルは可）", () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, "utils", "src"))) {
      const n = (readFileSync(f, "utf8").match(/^export (async )?function /gm) ?? []).length;
      if (n > 1) bad.push(`${relative(ROOT, f)}: ${n} functions`);
    }
    expect(bad).toEqual([]);
  });

  test("mod のバンドルは Herdr app の API だけを import し、Node / Bun の API を含まない", async () => {
    const out = await Bun.build({
      entrypoints: [join(ROOT, "herdr-app", "src", "agent-board", "main.ts")],
      format: "esm",
      target: "browser",
      external: ["herdr", "gpui-kit"],
    });
    expect(out.success).toBe(true);
    const code = await out.outputs[0]!.text();
    expect([...new Set(imports(code))].sort()).toEqual(["gpui-kit", "herdr"]);
    expect(code).not.toMatch(/\bBun\.|process\.|require\(|node:/);
  });
});
