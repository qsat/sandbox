import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CycleRecord } from "./plans/cycle";
import { COLLAPSED_KEY } from "./sidebar-order";

/** 畳んだ workspace のパス。ファイルが無い・読めない・形が違うときは、何も畳んでいないとみなす */
export async function readCollapsed(path: string): Promise<string[]> {
  try {
    const v = JSON.parse(await readFile(path, "utf8"))?.[COLLAPSED_KEY];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function readCycleRecord(path: string): Promise<CycleRecord | null> {
  try {
    const v = JSON.parse(await readFile(path, "utf8"));
    const valid = typeof v?.atMs === "number" && typeof v?.lastId === "string" && Array.isArray(v?.order) && v.order.every((x: unknown) => typeof x === "string");
    return valid ? { atMs: v.atMs, order: v.order, lastId: v.lastId } : null;
  } catch {
    return null;
  }
}

export async function writeCycleRecord(path: string, record: CycleRecord) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record) + "\n");
}
