import { agentDisplayName } from "./agent-display-name";

/** 一覧の行に出すエージェントの名前。Claude Code が付けたセッションのタイトルがあればアドレスとタイトル、無ければ agentDisplayName */
export function agentRowLabel(a: { id: string; name: string; title?: string }) {
  return a.title ? `${a.id} ${a.title}` : agentDisplayName(a);
}
