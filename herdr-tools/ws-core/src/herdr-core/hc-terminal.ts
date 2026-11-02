export interface HcTerminal {
  address: string;
  name: string | null;
  cwd: string;
  labels: Record<string, string>;
  parent: string | null;
  state: "live" | "finished";
  status: { state: string; kind?: string | null; msg?: string } | null;
  reported?: boolean;
  foreground: { name: string } | null;
}
