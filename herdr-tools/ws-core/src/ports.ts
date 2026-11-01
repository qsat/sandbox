// ポート: ws-core が事実の出どころに求めるもの。
// 本番の実装は ws-core 自身が持つ（AgentRuntime = herdr-core/runtime.ts、WorkspaceSource = adapters/git.ts）。
// インターフェースとして切ってあるのは、ユースケースの単体テストで偽物に差し替えるため。

import type { AgentRecord, PathInfo } from "./model";

export interface AgentStartSpec {
  /** 本体リポジトリのパス */
  workspace: string;
  /** worktree のパス（ここで起動する） */
  worktree: string;
  repo: string;
  branch: string | null;
  command: string[];
}

/** エージェントを動かし続ける実行環境 */
export interface AgentRuntime {
  list(): Promise<AgentRecord[]>;
  get(id: string): Promise<AgentRecord | undefined>;
  /** 起動して、識別子と実行環境が付けた名前を返す */
  start(spec: AgentStartSpec): Promise<{ id: string; name: string }>;
  /** エージェントプログラムの会話IDを、実行環境側に記録する */
  recordSession(id: string, sessionId: string): Promise<void>;
  /** 端末に文字列を入力して Enter */
  send(id: string, text: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** 実行環境の中で動いているプロセスから、自分のエージェントの id を得る */
  currentAgentId(env: Record<string, string | undefined>): string | undefined;
  /** 会話に入るためのコマンド（クライアントが自分の端末で実行する） */
  attachCommand(id: string): string;
  /** 変化があるたびに onChange を呼ぶ。戻り値で購読をやめる */
  subscribe(onChange: () => void): () => void;
}

/** 作業場所（リポジトリと worktree）の出どころ */
export interface WorkspaceSource {
  root(): Promise<string>;
  entries(root: string): Promise<string[]>;
  inspect(paths: string[]): Promise<PathInfo[]>;
}
