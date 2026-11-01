// コンポジションルート: ws-core（herdr-core と ghq / git の上に立つ）を設定から組み立て、クライアント（tmux）を載せる。

import { homedir } from "node:os";
import { GitWorkspaceSource, HerdrRuntime, WsCore } from "@herdr-tools/ws-core";
import { Tmux, TmuxNavigator } from "@herdr-tools/tmux";

export function compose(env: Record<string, string | undefined> = process.env) {
  const runtime = new HerdrRuntime({ hcBin: env.HC_BIN || "hc", sessionLabel: env.WS_SESSION_LABEL || undefined });
  const source = new GitWorkspaceSource({ gitBin: env.GIT_BIN || undefined, ghqBin: env.GHQ_BIN || undefined, root: env.GHQ_ROOT || undefined });
  const core = new WsCore(runtime, source, { home: homedir(), claudeBin: env.WS_CLAUDE_BIN || "claude" });
  const tmux = new Tmux({ bin: env.TMUX_BIN || undefined, socket: env.WS_TMUX_SOCKET || undefined });
  return { core, nav: new TmuxNavigator(core, tmux, env) };
}
