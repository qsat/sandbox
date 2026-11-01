export interface TmuxSession {
  name: string;
  path: string;
  attached: boolean;
}

export interface TmuxPane {
  paneId: string;
  agentId: string | null;
  dead: boolean;
}

export interface TmuxClient {
  name: string;
  activity: number;
}

export interface TmuxFacts {
  sessions: TmuxSession[];
  panes: TmuxPane[];
}
