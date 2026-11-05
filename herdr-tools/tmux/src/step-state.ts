import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StepRecord } from "./sidebar-order";

/** mod が畳んだ workspace のパスを入れる共有状態のキー（mod の main.ts の COLLAPSED_KEY と同じ） */
export const COLLAPSED_KEY = "agent-board.collapsed";

/** 畳んだ workspace のパス。ファイルが無い・読めない・形が違うときは、何も畳んでいないとみなす */
export async function readCollapsed(path: string): Promise<string[]> {
  try {
    const v = JSON.parse(await readFile(path, "utf8"))?.[COLLAPSED_KEY];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function readStepRecord(path: string): Promise<StepRecord | null> {
  try {
    const v = JSON.parse(await readFile(path, "utf8"));
    return typeof v?.row === "string" && typeof v?.pane === "string" ? { row: v.row, pane: v.pane } : null;
  } catch {
    return null;
  }
}

export async function writeStepRecord(path: string, record: StepRecord) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record) + "\n");
}
