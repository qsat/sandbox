import { homedir } from "node:os";
import { join } from "node:path";

/** 先頭の ~ をホームディレクトリに展開する */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}
