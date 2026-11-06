// 通知の文面。どのリポジトリ・ブランチで、何の依頼が、どう終わったかを書く。I/O なし
import { basename } from "@herdr-tools/utils/basename";
import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import type { AgentRow } from "./attention";
import type { TranscriptTail } from "./transcript";

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

/** 返答の冒頭として本文に出す行の数と文字数、副題に出す依頼の文字数 */
const REPLY_LINES = 3;
const REPLY_CHARS = 200;
const PROMPT_CHARS = 80;

/** ws list --json から、エージェントのリポジトリ・ブランチ・会話の記録の手がかりを引き当てる。見つからなければ null */
export function agentContext(list: ListedTree, agentId: string): AgentContext | null {
  for (const ws of list.workspaces) {
    for (const wt of ws.worktrees) {
      const a = wt.agents.find((x) => x.id === agentId);
      if (a) return { repo: basename(ws.name), branch: worktreeDisplayName(wt), cwd: a.cwd, claudeSessionId: a.claudeSessionId ?? null };
    }
  }
  return null;
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
 * 通知の題名・副題・本文。題名に「リポジトリ (ブランチ) が終わりました／待っています」、
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
