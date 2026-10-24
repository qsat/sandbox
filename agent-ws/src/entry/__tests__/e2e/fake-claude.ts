#!/usr/bin/env bun
/**
 * E2E 用の偽の claude: 記録した hook 入力を、settings.json の hooks 設定どおりに hook コマンドへ渡す
 *
 * `claude` という名前（シンボリックリンク）で起動する。ps からは `bun …/claude` に見えるので、本物と同じくエージェントとして見つかる。
 * hook コマンドはこのプロセスの子として動くので、本体の pid も本物と同じく祖先を辿って特定される。
 *
 * 起動したら SessionStart を流し、端末（tmux のペイン）から1行ずつ読む:
 *   "1 2"  記録の1行目と2行目（0 始まり）を順に流す
 *   "exit" SessionEnd を流して終わる
 * 1行流し終えるたびに "[ok n]"（n は何行目か）を出す。テストはこれを待てば、hook が終わったことが分かる
 *
 * 環境変数: FAKE_CLAUDE_INPUTS（記録した hook 入力の JSONL）、CLAUDE_CONFIG_DIR（settings.json の置き場所）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Hook {
  command: string;
  args?: string[];
}
interface HookGroup {
  matcher?: string;
  hooks: Hook[];
}
type Input = Record<string, unknown>;

const configDir = process.env.CLAUDE_CONFIG_DIR ?? "";
const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8")) as { hooks?: Record<string, HookGroup[]> };
const recorded = readFileSync(process.env.FAKE_CLAUDE_INPUTS ?? "", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Input);

const sessionId = `e2e-${process.pid}`;
const transcript = join(configDir, "projects", `${sessionId}.jsonl`);
mkdirSync(join(configDir, "projects"), { recursive: true });
writeFileSync(transcript, "");

/** matcher は、ツールのイベントならツール名、Notification なら種別、SessionStart なら起動のしかたに当てる */
const matches = (matcher: string | undefined, input: Input) =>
  !matcher ||
  matcher === "*" ||
  new RegExp(`^(?:${matcher})$`).test(String(input.tool_name ?? input.notification_type ?? input.source ?? ""));

async function fire(record: Input): Promise<void> {
  const input: Input = { ...record, session_id: sessionId, cwd: process.cwd(), transcript_path: transcript };
  for (const group of settings.hooks?.[String(input.hook_event_name)] ?? []) {
    if (!matches(group.matcher, input)) continue;
    for (const h of group.hooks) {
      await Bun.spawn([h.command, ...(h.args ?? [])], { stdin: new Blob([JSON.stringify(input)]), stdout: "ignore", stderr: "inherit" })
        .exited;
    }
  }
}

const byEvent = (name: string) => recorded.filter((r) => r.hook_event_name === name).slice(0, 1);

for (const r of byEvent("SessionStart")) await fire(r);
let done = 0;
process.stdout.write("> ");
for await (const line of console) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words[0] === "exit") {
    for (const r of byEvent("SessionEnd")) await fire(r);
    process.exit(0);
  }
  for (const i of words.map(Number)) await fire(recorded[i]);
  process.stdout.write(`[ok ${++done}]\n> `);
}
