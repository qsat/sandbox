import { homedir } from "node:os";
import { GhqWorkspaceSource, HcClient, HerdrRuntime, HerdrUsageStore, WsCore } from "@herdr-tools/ws-core";
import { TmuxNavigator, TmuxServer } from "@herdr-tools/tmux";

export function composeFromEnv(env: Record<string, string | undefined>) {
  const hc = new HcClient(env.HC_BIN || undefined);
  const runtime = new HerdrRuntime(hc, { claudeSessionLabel: env.WS_SESSION_LABEL || undefined });
  const source = new GhqWorkspaceSource({ git: env.GIT_BIN || undefined, ghq: env.GHQ_BIN || undefined, ghqRoot: env.GHQ_ROOT || undefined });
  const core = new WsCore(runtime, source, { home: homedir(), claudeBin: env.WS_CLAUDE_BIN || undefined, usageStore: new HerdrUsageStore(hc) });
  const tmux = new TmuxServer({ bin: env.TMUX_BIN || undefined, socketName: env.WS_TMUX_SOCKET || undefined });
  return { core, nav: new TmuxNavigator(core, tmux, env) };
}
