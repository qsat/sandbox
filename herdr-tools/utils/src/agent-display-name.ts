export function agentDisplayName(a: { id: string; name: string }) {
  return a.name === a.id ? a.id.replace(/^t(\d+)$/, "agent-$1") : `${a.id} ${a.name}`;
}
