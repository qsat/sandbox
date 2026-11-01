// ws-core: Workspace > Worktree > Agent のドメインとユースケース。
// 事実の出どころ（herdr-core、git / ghq）は知っている。クライアント（tmux、Herdr app）のことは知らない。

export * from "./model";
export * from "./tree";
export * from "./ports";
export * from "./claude";
export * from "./service";
export { GitWorkspaceSource, expandHome, type GitSourceOptions } from "./adapters/git";
export * from "./herdr-core/runtime";
export { Hc, HcRpc, normalizeTerminal, type HcTerminal, type HcRunSpec } from "./herdr-core/hc";
export { run, runOk, runInteractive, mapLimit, shellQuote, type RunResult, type RunOptions } from "./util/exec";
