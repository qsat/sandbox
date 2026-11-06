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
  /** 最後に操作したクライアント（client_activity が一番新しい）が表示しているペイン（current-pane.ts の markCurrentPanes） */
  current: boolean;
}

export interface TmuxClient {
  name: string;
  activity: number;
  /** クライアントが表示しているセッションの名前 */
  session: string;
}

export interface TmuxFacts {
  sessions: TmuxSession[];
  panes: TmuxPane[];
}
