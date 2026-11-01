// 依存の向きの検査:
//   ws-core   … 何にも依存しない。tmux / herdr の名前すら出さない
//   herdr     … ws-core だけ
//   tmux      … ws-core だけ（herdr を知らない）
//   ws（CLI） … すべてをつなぐ
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

describe("依存の向き", () => {
  test("ws-core は外部に依存しない", () => expect(check("ws-core", [])).toEqual([]));
  test("herdr は ws-core だけ", () => expect(check("herdr", ["@herdr-tools/ws-core"])).toEqual([]));
  test("tmux は ws-core だけ（herdr を知らない）", () => expect(check("tmux", ["@herdr-tools/ws-core"])).toEqual([]));

  test("ws-core のコードに tmux / herdr / hc が出てこない", () => {
    const hits: string[] = [];
    for (const f of files(join(ROOT, "ws-core", "src"))) {
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (/tmux|herdr|\bhc\b|HC_/i.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("tmux のコードに herdr / hc が出てこない", () => {
    const hits: string[] = [];
    for (const f of files(join(ROOT, "tmux", "src"))) {
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (/herdr(?!-tools)|\bhc\b|HC_/i.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
