// コンポジションルート: ws-core に実行環境（herdr-core）と作業場所（ghq / git）をつなぎ、クライアント（tmux）を載せる。
// 具体的な実装を知っているのはここだけ。

import { homedir } from "node:os";
import { GitWorkspaceSource, WsCore } from "@herdr-tools/ws-core";
import { HerdrRuntime } from "@herdr-tools/herdr";
import { Tmux, TmuxNavigator } from "@herdr-tools/tmux";

export interface Composition {
  core: WsCore;
  nav: TmuxNavigator;
}

export function compose(env: Record<string, string | undefined> = process.env): Composition {
  const runtime = new HerdrRuntime({ hcBin: env.HC_BIN || "hc", sessionLabel: env.WS_SESSION_LABEL || undefined });
  const source = new GitWorkspaceSource({ gitBin: env.GIT_BIN || undefined, ghqBin: env.GHQ_BIN || undefined, root: env.GHQ_ROOT || undefined });
  const core = new WsCore(runtime, source, { home: homedir(), claudeBin: env.WS_CLAUDE_BIN || "claude" });
  const tmux = new Tmux({ bin: env.TMUX_BIN || undefined, socket: env.WS_TMUX_SOCKET || undefined });
  return { core, nav: new TmuxNavigator(core, tmux, env) };
}
