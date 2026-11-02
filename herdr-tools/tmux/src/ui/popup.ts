import type { TmuxNavigator } from "../navigator";
import { basename } from "@herdr-tools/utils/basename";
import { splitKeys } from "./keys";
import { firstSelectable, isSelectable, keepSelectionOn, nextSelectable, toRows, type Row } from "./rows";

const ESC = "\x1b";
const NO_WRAP = `${ESC}[?7l`;
const WRAP = `${ESC}[?7h`;
const ALT_ON = `${ESC}[?1049h${ESC}[?25l${NO_WRAP}`;
const ALT_OFF = `${WRAP}${ESC}[?25h${ESC}[?1049l`;
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
  let closeAsked: { worktreePath: string; name: string } | null = null;

  const render = () => {
    if (done) return;
    const height = (out.rows || 24) - 3;
    const width = out.columns || 80;
    const top = Math.max(0, Math.min(sel - Math.floor(height / 2), rows.length - height));
    const lines = rows.slice(top, top + height).map((r, i) => {
      const text = "  ".repeat(r.depth) + r.text;
      return top + i === sel && isSelectable(r) ? INVERT + stripAnsi(text).slice(0, width) + RESET : text;
    });
    if (rows.length === 0) lines.push(DIM + "（表示するものがありません。a で全 worktree を表示）" + RESET);
    while (lines.length < height) lines.push("");
    const help = `${DIM}Enter:移動 n:新規 R:再開 x:セッション終了 a:${all ? "絞込" : "全部"} r:再読込 q:閉じる${RESET}`;
    const prompt = closeAsked ? `${ESC}[33m${closeAsked.name} の tmux セッションを閉じますか？ y/N${RESET}` : message;
    out.write(CLEAR + lines.join("\r\n") + "\r\n" + prompt + "\r\n" + help);
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
      rows = toRows(view.snap.tree, view.idx, { attentionFirst: true, color: true, keyHints: true, look: "board" });
      sel = keepSelectionOn(rows, isSelectable(current) ? current.ref : undefined);
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
      if (closeAsked) {
        const asked = closeAsked;
        closeAsked = null;
        if (k !== "y" && k !== "Y") return render();
        return void act(async () => {
          const res = await nav.closeSessionOf(asked.worktreePath);
          return res.closed ? `閉じました: ${res.session}` : "tmux セッションはありません";
        }, false);
      }
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
          if (!isSelectable(r)) return;
          return void act(async () => {
            await nav.goRef(r.ref, { client: opts.client });
          }, true);
        case "n":
          if (!isSelectable(r)) return;
          return void act(async () => {
            await nav.startAgentAndGo(r.worktree.path, [], { client: opts.client });
          }, true);
        case "x":
          if (!isSelectable(r)) return;
          closeAsked = { worktreePath: r.worktree.path, name: basename(r.worktree.path) };
          return render();
        case "R":
          if (!r || r.kind !== "agent") return;
          return void act(async () => {
            const res = await nav.core.resume(r.agent.id);
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
