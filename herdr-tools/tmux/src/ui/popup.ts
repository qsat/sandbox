import type { TmuxNavigator } from "../navigator";
import { splitKeys } from "./keys";
import { firstSelectable, isSelectable, keepSelectionOn, nextSelectable, toRows, type Row } from "./rows";

const ESC = "\x1b";
const ALT_ON = `${ESC}[?1049h${ESC}[?25l`;
const ALT_OFF = `${ESC}[?25h${ESC}[?1049l`;
const CLEAR = `${ESC}[H${ESC}[2J`;
const INVERT = `${ESC}[7m`;
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;

export async function runPopup(nav: TmuxNavigator, opts: { client?: string }) {
  const out = process.stdout;
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("ws ui は端末（tmux の popup）から実行してください");

  let rows: Row[] = [];
  let sel = 0;
  let all = false;
  let message = "";
  let busy = false;
  let loading = false;
  let reloadQueued = false;
  let done = false;

  const render = () => {
    if (done) return;
    const height = (out.rows || 24) - 2;
    const width = out.columns || 80;
    const top = Math.max(0, Math.min(sel - Math.floor(height / 2), rows.length - height));
    const lines = rows.slice(top, top + height).map((r, i) => {
      const text = "  ".repeat(r.depth) + r.text;
      return top + i === sel && isSelectable(r) ? INVERT + stripAnsi(text).slice(0, width) + RESET : text;
    });
    if (rows.length === 0) lines.push(DIM + "（表示するものがありません。a で全 worktree を表示）" + RESET);
    while (lines.length < height) lines.push("");
    const help = `${DIM}Enter:移動  n:新規  R:再開  a:${all ? "絞込" : "全部"}  r:再読込  q:閉じる${RESET}`;
    out.write(CLEAR + lines.join("\r\n") + "\r\n" + (message ? message + "  " : "") + help);
  };

  const reload = async () => {
    if (loading) {
      reloadQueued = true;
      return;
    }
    loading = true;
    try {
      const current = rows[sel];
      const view = await nav.view({ allEntries: all });
      rows = toRows(view.snap.tree, view.idx, { attentionFirst: true, color: true });
      sel = keepSelectionOn(rows, current && current.kind !== "workspace" ? current.ref : undefined);
    } catch (e) {
      message = `読み込み失敗: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
    render();
    if (reloadQueued) {
      reloadQueued = false;
      void reload();
    }
  };

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const scheduleReload = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void reload(), 200);
  };

  const unsubscribe = nav.core.subscribe(scheduleReload);
  const timer = setInterval(() => void reload(), 3000);

  const cleanup = () => {
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    unsubscribe();
    try {
      stdin.setRawMode(false);
    } catch {}
    stdin.pause();
    out.write(ALT_OFF);
  };

  out.write(ALT_ON);
  stdin.setRawMode(true);
  stdin.resume();
  render();
  await reload();

  await new Promise<void>((resolveDone) => {
    const finish = () => {
      if (done) return;
      done = true;
      stdin.off("data", onData);
      cleanup();
      resolveDone();
    };

    const act = async (fn: () => Promise<string | void>, closeAfter: boolean) => {
      if (busy) return;
      busy = true;
      message = "…";
      render();
      try {
        const m = await fn();
        if (closeAfter) return finish();
        message = m || "";
      } catch (e) {
        message = `${ESC}[31m${(e as Error).message}${RESET}`;
      } finally {
        busy = false;
      }
      await reload();
    };

    const onData = (buf: Buffer) => {
      for (const k of splitKeys(buf.toString())) if (!done) onKey(k);
    };

    const onKey = (k: string) => {
      const r = rows[sel];
      switch (k) {
        case "q":
        case ESC:
        case "\x03":
          return finish();
        case "j":
        case `${ESC}[B`:
          sel = nextSelectable(rows, sel, 1);
          return render();
        case "k":
        case `${ESC}[A`:
          sel = nextSelectable(rows, sel, -1);
          return render();
        case "g":
          sel = firstSelectable(rows);
          return render();
        case "G": {
          for (let i = rows.length - 1; i >= 0; i--) if (isSelectable(rows[i])) return ((sel = i), render());
          return;
        }
        case "r":
          return void reload();
        case "a":
          all = !all;
          return void reload();
        case "\r":
        case "\n":
          if (!r || r.kind === "workspace") return;
          return void act(async () => {
            await nav.goRef(r.ref, { client: opts.client });
          }, true);
        case "n":
          if (!r || r.kind === "workspace") return;
          return void act(async () => {
            await nav.startAgentAndGo(r.worktree.path, [], { client: opts.client });
          }, true);
        case "R":
          if (!r || r.kind !== "agent") return;
          return void act(async () => {
            const res = await nav.core.resumeIfNeeded(r.agent.id);
            return res.resumed ? `再開しました: ${r.agent.id}` : `再開不要: ${res.reason}`;
          }, false);
      }
    };
    stdin.on("data", onData);
    process.stdout.on("resize", render);
  });
}

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}
