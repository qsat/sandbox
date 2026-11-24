export interface TmuxSession {
  name: string;
  path: string;
  attached: boolean;
}

export interface TmuxPane {
  paneId: string;
  agentId: string | null;
  dead: boolean;
  session: string;
  /** ペインのあるウィンドウの名前 */
  window: string;
  command: string;
  /** ws が操作するクライアントが表示しているペイン（current-pane.ts の markCurrentPanes） */
  current: boolean;
}

export interface TmuxClient {
  /** 端末のクライアントでは tty のパス（/dev/ttys013） */
  name: string;
  activity: number;
  /** tmux につながった時刻（client_created） */
  created: number;
  /** クライアントの端末の種類（client_termname。Ghostty なら xterm-ghostty） */
  termname: string;
  /** クライアントが表示しているセッションの名前 */
  session: string;
}

export interface TmuxFacts {
  sessions: TmuxSession[];
  panes: TmuxPane[];
}
