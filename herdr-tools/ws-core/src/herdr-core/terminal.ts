// herdr-core の Terminal（schema/hc.openrpc.json の components.schemas.Terminal のうち、使う項目だけ）。
// I/O なし。Herdr app の terminals() も同じ形なので、mod からも使う。

export interface HcTerminal {
  /** t7: この core で不変 */
  address: string;
  name: string | null;
  cwd: string;
  labels: Record<string, string>;
  parent: string | null;
  state: "live" | "finished";
  /** プログラムが OSC 7501 で名乗った状態。名乗ったことが無ければ null */
  status: {
    /** idle, working, done, blocked or error */
    state: string;
    /** permission, question or auth（blocked のときだけ） */
    kind?: string | null;
    msg?: string;
  } | null;
  /** 今の前面プロセス（終了後は null） */
  foreground: { name: string } | null;
}
