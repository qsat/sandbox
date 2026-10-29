/**
 * 依存の向き: 上の層は下の層だけを import する（テストのコードは除く）
 *
 *   entry（cli と境界の補助 utils）→ commands → ui・redux/middlewares → redux/createStore・rootReducer → redux/modules → redux/types・utils → lib
 *   （ui と redux/middlewares は互いに知らない）
 *
 * 例外は1つ: modules の selector は rootReducer.ts の RootState を型としてだけ読んでよい（状態の形は rootReducer が決めるため）。
 * 型だけなので実行時の依存は無く、slice は selector を読まないのでファイル単位の循環にもならない
 *
 * あわせて、ファイル単位の循環が無いこと、ドメイン（modules/app）が画面（modules/ui）を知らないこと、
 * middleware が他の外部システムの middleware 本体（index.ts）に頼らないこと（使ってよいのはそのシステムの I/O だけ）を確かめる
 */
import { expect, test } from "bun:test";
import { dirname, join, normalize, relative } from "node:path";
import { Glob } from "bun";

const SRC = join(import.meta.dir, "..");

const LAYERS = ["entry", "commands", "ui", "middlewares", "store", "modules", "domain", "lib"] as const;
type Layer = (typeof LAYERS)[number];

/** ファイル → 層 */
const LAYER_OF: [RegExp, Layer][] = [
  [/^commands\//, "commands"],
  [/^entry\//, "entry"],
  [/^ui\//, "ui"],
  [/^redux\/middlewares\//, "middlewares"],
  [/^redux\/(createStore|rootReducer)\.ts$/, "store"],
  [/^redux\/modules\//, "modules"],
  [/^redux\/(types|utils)\//, "domain"],
  [/^lib\//, "lib"],
];
const layerOf = (file: string) => LAYER_OF.find(([re]) => re.test(file))?.[1];

/** 層 → import してよい層（自分の層も含む） */
const ALLOWED: Record<Layer, Layer[]> = {
  entry: ["entry", "commands", "ui", "middlewares", "store", "modules", "domain", "lib"],
  commands: ["commands", "ui", "middlewares", "store", "modules", "domain", "lib"],
  ui: ["ui", "store", "modules", "domain", "lib"],
  middlewares: ["middlewares", "store", "modules", "domain", "lib"],
  store: ["store", "modules", "domain", "lib"],
  modules: ["modules", "domain", "lib"],
  domain: ["domain", "lib"],
  lib: ["lib"],
};

interface Import {
  to: string; // src からの相対パス
  typeOnly: boolean; // import type { … }
}

/** import・export … from（import type なら型だけ）・副作用だけの import・動的 import */
const STATIC = /^\s*(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+"(\.[^"]+)"/gm;
const BARE = /^\s*import\s+"(\.[^"]+)"/gm;
const DYNAMIC = /import\(\s*"(\.[^"]+)"\s*\)/g;

/** src からの相対パス → import している src のファイル（相対 import だけ） */
const files = [...new Glob("**/*.ts").scanSync(SRC)].filter((f) => !f.includes("__tests__"));
const imports = new Map(
  await Promise.all(
    files.map(async (f) => {
      const text = await Bun.file(join(SRC, f)).text();
      const found = [
        ...[...text.matchAll(STATIC)].map((m) => ({ spec: m[2], typeOnly: Boolean(m[1]) })),
        ...[...text.matchAll(BARE)].map((m) => ({ spec: m[1], typeOnly: false })),
        ...[...text.matchAll(DYNAMIC)].map((m) => ({ spec: m[1], typeOnly: false })),
      ].map(({ spec, typeOnly }): Import => ({ to: normalize(join(dirname(f), spec)), typeOnly }));
      return [f, found] as const;
    }),
  ),
);
const edges = [...imports].flatMap(([from, tos]) => tos.map(({ to, typeOnly }) => ({ from, to, typeOnly })));

/** 例外: modules の selector が RootState を型としてだけ読む */
const readsRootState = (e: { from: string; to: string; typeOnly: boolean }) =>
  e.typeOnly && e.from.startsWith("redux/modules/") && e.to === "redux/rootReducer.ts";

/** 失敗したときに、どの import が違反かを読めるようにする */
const shown = (es: { from: string; to: string }[]) => es.map(({ from, to }) => `${from} → ${to}`);

test("どのファイルも、いずれかの層に入っている", () => {
  expect(files.filter((f) => !layerOf(f))).toEqual([]);
});

test("上の層は下の層だけを import する", () => {
  const wrong = edges.filter((e) => !readsRootState(e) && !ALLOWED[layerOf(e.from) ?? "lib"].includes(layerOf(e.to) ?? "lib"));
  expect(shown(wrong)).toEqual([]);
});

test("ドメイン（modules/app）は画面（modules/ui）を知らない", () => {
  const wrong = edges.filter(({ from, to }) => from.startsWith("redux/modules/app/") && to.startsWith("redux/modules/ui/"));
  expect(shown(wrong)).toEqual([]);
});

test("middleware は他の外部システムの middleware 本体に頼らない（I/O のファイルは使ってよい）", () => {
  const system = (f: string) => f.match(/^redux\/middlewares\/([^/]+)\//)?.[1];
  const wrong = edges.filter(({ from, to }) => system(from) && system(to) && system(from) !== system(to) && to.endsWith("/index.ts"));
  expect(shown(wrong)).toEqual([]);
});

test("ファイル単位の循環が無い", () => {
  const visiting = new Set<string>();
  const done = new Set<string>();
  /** 循環していれば、その経路 */
  const cycleFrom = (f: string, path: string[]): string[] | null => {
    if (visiting.has(f)) return [...path.slice(path.indexOf(f)), f];
    if (done.has(f)) return null;
    visiting.add(f);
    const found = (imports.get(f) ?? []).map(({ to }) => cycleFrom(to, [...path, f])).find((c) => c !== null) ?? null;
    visiting.delete(f);
    done.add(f);
    return found;
  };
  const cycles = files.map((f) => cycleFrom(f, [])).filter((c) => c !== null);
  expect(cycles.map((c) => c.map((f) => relative(".", f)).join(" → "))).toEqual([]);
});
