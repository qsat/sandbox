// 通知を実際に出す。会話の記録の末尾を読み、通知のコマンドを順に試し、結果をログに残す。
// I/O は Herdr app の API（exec / readTextFile / writeTextFile）を引数で受け取り、テストでは偽物に差し替える
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import type { AgentRow } from "./attention";
import { notifyCommands } from "./commands";
import { agentContext, attentionMessage } from "./message";
import { EMPTY_TAIL, parseTranscriptTail, transcriptPath } from "./transcript";

/** notifier が使う I/O。agent-board の main.ts が Herdr app の API を渡す */
export interface NotifyIo {
  home: string;
  /** 起動できないときは reject する（Herdr app の exec と同じ） */
  exec(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, text: string, expected: string | null): Promise<unknown>;
}

/** 最後に出した通知で試したコマンドとその結果（ホームからの相対パス） */
export const NOTIFY_LOG = ".cache/herdr-tools/notify.log";
/** 通知に書く最後の依頼と返答を探す、会話の記録の末尾の行数 */
const TRANSCRIPT_TAIL_LINES = 300;

/** 1 つのエージェントの通知を出す。会話の記録の末尾から、最後の依頼と返答の冒頭を読んで書き添える */
export async function notifyAgent(row: AgentRow, list: ListedTree, io: NotifyIo) {
  const ctx = agentContext(list, row.key);
  const tail = ctx?.claudeSessionId ? parseTranscriptTail(await readTranscriptTail(transcriptPath(io.home, ctx.cwd, ctx.claudeSessionId), io)) : EMPTY_TAIL;
  await postNotification(notifyCommands(attentionMessage(row, ctx, tail), row.key, io.home), io, new Date());
}

/** 会話の記録の末尾を読む。記録は数 MB になるので、readTextFile（1 MiB まで）ではなく tail で末尾の行だけを読む。読めなければ空 */
async function readTranscriptTail(path: string, io: NotifyIo) {
  try {
    const r = await io.exec("tail", ["-n", String(TRANSCRIPT_TAIL_LINES), path]);
    return r.code === 0 ? r.stdout : "";
  } catch {
    return "";
  }
}

/**
 * 通知を出すコマンドを順に試し、終了コード 0 で終わったところで止める。
 * 起動できない（exec が reject する）ときと、通知の許可が無い（terminal-notifier が 0 以外で終わる）ときは次を試す。
 * どのコマンドを試してどう終わったかを NOTIFY_LOG に残し（スクリプトエディタから届いたときに理由を確かめる）、その行を返す
 */
export async function postNotification(commands: [string, string[]][], io: NotifyIo, now: Date) {
  const attempts: string[] = [];
  for (const [command, args] of commands) {
    try {
      const r = await io.exec(command, args);
      attempts.push(`${command}: exit ${r.code} ${r.stderr.trim()}`.trim());
      if (r.code === 0) break;
    } catch (e) {
      attempts.push(`${command}: 起動できない ${String((e as Error)?.message ?? e)}`);
    }
  }
  const path = `${io.home}/${NOTIFY_LOG}`;
  const text = `${now.toISOString()}\n${attempts.join("\n")}\n`;
  await io.writeTextFile(path, text, await io.readTextFile(path)).catch(() => {});
  return attempts;
}
