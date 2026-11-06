import type { ListedTree } from "@herdr-tools/tmux/list-json";
import type { BoardRow } from "./board";

type AgentRow = Extract<BoardRow, { kind: "agent" }>;

/** 通知の題名・副題・本文 */
export interface NotificationMessage {
  title: string;
  subtitle: string;
  body: string;
}

/** 通知に書くための、エージェントの場所と会話の記録の手がかり（ws list --json から） */
export interface AgentContext {
  /** リポジトリの名前（github.com/<owner>/<repo> の <repo>） */
  repo: string;
  /** worktree のブランチ。無ければフォルダー名 */
  branch: string;
  /** Claude Code が動いているディレクトリ（会話の記録のフォルダー名になる） */
  cwd: string;
  claudeSessionId: string | null;
}

/** 会話の記録から読む、最後の依頼と返答 */
export interface TranscriptTail {
  lastPrompt: string | null;
  lastReply: string | null;
}

/** 返答の冒頭として本文に出す行の数と文字数 */
const REPLY_LINES = 3;
const REPLY_CHARS = 200;
const PROMPT_CHARS = 80;

/** ユーザーに知らせる status。blocked はユーザーを待っている、done は見ていない間に終わった（見ると Herdr が idle に戻す） */
const ATTENTION_STATUSES = new Set(["blocked", "done"]);

/**
 * 前回見た status と比べ、blocked か done に変わったエージェントを返す。
 * prev が null（mod を読み込んで最初の 1 回）は、今の status を覚えるだけで何も返さない。読み込み直しのたびに通知が出ないようにするため。
 */
export function attentionChanges(prev: Map<string, string> | null, rows: BoardRow[]) {
  const agents = rows.filter((r): r is AgentRow => r.kind === "agent");
  const next = new Map(agents.map((a) => [a.key, a.rawStatus]));
  const changed = prev === null ? [] : agents.filter((a) => ATTENTION_STATUSES.has(a.rawStatus) && prev.get(a.key) !== a.rawStatus);
  return { changed, next };
}

/** ws list --json から、エージェントのリポジトリ・ブランチ・会話の記録の手がかりを引き当てる。見つからなければ null */
export function agentContext(list: ListedTree, agentId: string): AgentContext | null {
  for (const ws of list.workspaces) {
    for (const wt of ws.worktrees) {
      const a = wt.agents.find((x) => x.id === agentId);
      if (!a) continue;
      return {
        repo: ws.name.split("/").filter(Boolean).at(-1) ?? ws.name,
        branch: wt.branch ?? wt.path.split("/").filter(Boolean).at(-1) ?? wt.path,
        cwd: a.cwd,
        claudeSessionId: a.claudeSessionId ?? null,
      };
    }
  }
  return null;
}

/** Claude Code の会話の記録のパス。フォルダー名は cwd の英数字以外を - に置き換えたもの */
export function transcriptPath(home: string, cwd: string, sessionId: string) {
  return `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;
}

/**
 * 会話の記録（JSONL）の末尾から、最後の依頼（last-prompt の行）と最後の返答（assistant の text）を読む。
 * 末尾だけを渡すので、1 行目が途中で切れていたり、壊れた行があったりしても飛ばす
 */
export function parseTranscriptTail(text: string): TranscriptTail {
  let lastPrompt: string | null = null;
  let lastReply: string | null = null;
  for (const line of text.split("\n")) {
    let j: { type?: string; lastPrompt?: unknown; message?: { content?: unknown } };
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type === "last-prompt" && typeof j.lastPrompt === "string") lastPrompt = j.lastPrompt;
    if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      const texts = (j.message.content as { type?: string; text?: unknown }[]).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
      if (texts.length > 0) lastReply = texts.join("\n");
    }
  }
  return { lastPrompt, lastReply };
}

/** 長い文を max 文字で切り、切ったら … を付ける */
function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 返答の冒頭。Markdown の記号（見出しの #、箇条書きの -、強調の **、コードの `）を外し、空行を除いた最初の数行 */
export function replyHead(reply: string) {
  const lines = reply
    .split("\n")
    // 記号を外す前に、コードの囲みと表の区切り線を飛ばす
    .filter((l) => !l.trim().startsWith("```") && !/^\s*\|?[-:| ]+\|?\s*$/.test(l))
    .map((l) =>
      l
        .replace(/^\s*(#+|[-*]|\d+\.)\s+/, "")
        .replace(/\*\*|`/g, "")
        .trim(),
    )
    .filter((l) => l !== "");
  return clip(lines.slice(0, REPLY_LINES).join("\n"), REPLY_CHARS);
}

/**
 * 通知の題名・副題・本文。題名に「リポジトリ（ブランチ）が終わりました／待っています」、
 * 副題に最後の依頼、本文に返答の冒頭を書く。会話の記録が読めなければ、副題と本文はエージェントの名前で埋める
 */
export function attentionMessage(row: AgentRow, ctx: AgentContext | null, tail: TranscriptTail): NotificationMessage {
  const what = row.rawStatus === "blocked" ? "待っています" : "終わりました";
  const where = ctx ? `${ctx.repo} (${ctx.branch})` : row.label;
  return {
    title: `${where} が${what}`,
    subtitle: tail.lastPrompt ? clip(tail.lastPrompt.replace(/\s+/g, " ").trim(), PROMPT_CHARS) : row.label,
    body: tail.lastReply ? replyHead(tail.lastReply) || row.label : row.label,
  };
}

/** osascript の引数。題名・副題・本文は argv で渡し、AppleScript の文字列に埋め込まない（引用符を含んでも壊れない） */
export function osascriptArgs(message: NotificationMessage) {
  return [
    "-e",
    "on run argv",
    "-e",
    "display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
    "-e",
    "end run",
    "--",
    message.title,
    message.subtitle,
    message.body,
  ];
}

/** シェルの 1 語として渡すための引用。' は '\'' に置き換える */
function shellQuote(s: string) {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * 通知をクリックしたときに terminal-notifier が実行するシェルのコマンド。ws go <エージェント> --from-app で、
 * tmux の会話ペインへ移り Ghostty を前に出す。terminal-notifier のシェルは PATH が短いので、
 * ws と、ws が呼ぶ tmux・hc・ghq・git が見つかる PATH を書く
 */
export function goOnClickCommand(agentKey: string, home: string) {
  const path = [`${home}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  return `PATH=${shellQuote(path)} ws go ${shellQuote(agentKey)} --from-app`;
}

/**
 * 通知を出すコマンドを、試す順に返す。terminal-notifier（クリックでその会話へ移れる）を先に、
 * 見つからなければ osascript（クリックしても移れない）。Herdr app の PATH に Homebrew が入っていないこともあるので、
 * terminal-notifier はよくある場所を絶対パスで先に試す。同じエージェントの通知は group で 1 つにまとめる
 */
export function notifyCommands(message: NotificationMessage, agentKey: string, home: string): [string, string[]][] {
  // terminal-notifier は、本文が [ で始まると読めないことがあるので \ を前に付ける（terminal-notifier -help の注意書き）
  const body = message.body.startsWith("[") ? `\\${message.body}` : message.body;
  const tnArgs = [
    "-title",
    message.title,
    "-subtitle",
    message.subtitle,
    "-message",
    body,
    "-group",
    `herdr-tools.${agentKey}`,
    "-execute",
    goOnClickCommand(agentKey, home),
  ];
  return [
    ["/opt/homebrew/bin/terminal-notifier", tnArgs],
    ["/usr/local/bin/terminal-notifier", tnArgs],
    ["terminal-notifier", tnArgs],
    ["osascript", osascriptArgs(message)],
  ];
}
