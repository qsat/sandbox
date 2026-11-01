// 依存の向きの検査:
//   ws-core    … 外部パッケージに依存しない。事実の出どころ（herdr-core、git / ghq）は知ってよいが、
//                クライアント（tmux、Herdr app）の名前は出さない
//   tmux       … ws-core だけ。herdr-core（hc）を直接触らない
//   herdr-app  … Herdr app の mod。ws を exec するだけで、このリポジトリのコードを import しない
//   ws（CLI）  … すべてをつなぐ
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
      if (!allowed.includes(spec)) bad.push(`${relative(ROOT, f)}: ${spec}`);
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

describe("依存の向き", () => {
  test("ws-core は外部パッケージに依存しない", () => expect(check("ws-core", [])).toEqual([]));
  test("tmux は ws-core だけ", () => expect(check("tmux", ["@herdr-tools/ws-core"])).toEqual([]));

  test("ws-core のコードにクライアント（tmux / Herdr app）が出てこない", () => {
    expect(codeHits(join(ROOT, "ws-core", "src"), /tmux|herdr-app|gpui|agent-board/i)).toEqual([]);
  });

  test("tmux のコードは herdr-core（hc）を直接触らない", () => {
    expect(codeHits(join(ROOT, "tmux", "src"), /\bhc\b|HC_|herdr(?!-tools)|HerdrRuntime/i)).toEqual([]);
  });

  test("Herdr app の mod は Herdr app の API だけを import する（ws とは exec で話す）", () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, "herdr-app", "mod", "agent-board")))
      for (const spec of imports(readFileSync(f, "utf8"))) if (!["herdr", "gpui-kit"].includes(spec)) bad.push(`${relative(ROOT, f)}: ${spec}`);
    expect(bad).toEqual([]);
  });
});
