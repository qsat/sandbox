import type { TmuxNavigator } from "../navigator";
import { agentDisplayName } from "@herdr-tools/utils/agent-display-name";
import { basename } from "@herdr-tools/utils/basename";
import { splitKeys } from "./keys";
import { fitToWidth, frame } from "./screen";
import { firstSelectable, isSelectable, keepSelectionOn, nextSelectable, toRows, usageLine, type Row } from "./rows";

const ESC = "\x1b";
const NO_WRAP = `${ESC}[?7l`;
const WRAP = `${ESC}[?7h`;
const ALT_ON = `${ESC}[?1049h${ESC}[?25l${NO_WRAP}`;
const ALT_OFF = `${WRAP}${ESC}[?25h${ESC}[?1049l`;
const CLEAR = `${ESC}[H${ESC}[2J`;
const SELECTED_BG = `${ESC}[48;2;56;60;14m`;
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const PADDING = { x: 3, y: 1 };

export async function runPopup(nav: TmuxNavigator, opts: { client?: string }) {
  const out = process.stdout;
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("ws ui は端末（tmux の popup）から実行してください");

  let rows: Row[] = [];
  let usageHeader = "";
  let sel = 0;
  let all = false;
  let message = "";
  let busy = false;
  let loading = false;
  let reloadQueued = false;
  let done = false;
  let confirming: { question: string; run: () => Promise<string> } | null = null;

  const render = () => {
    if (done) return;
    const size = { columns: out.columns || 80, rows: out.rows || 24 };
    const inner = size.columns - PADDING.x * 2;
    const header = usageHeader ? [" ".repeat(Math.max(0, inner - Bun.stringWidth(stripAnsi(usageHeader)))) + usageHeader] : [];
    const height = size.rows - PADDING.y * 2 - 2 - header.length;
    const top = Math.max(0, Math.min(sel - Math.floor(height / 2), rows.length - height));
    const lines = rows.slice(top, top + height).map((r, i) => {
      const text = "  ".repeat(r.depth) + r.text;
      if (top + i !== sel || !isSelectable(r)) return text;
      const fitted = fitToWidth(text, inner);
      const fill = " ".repeat(Math.max(0, inner - Bun.stringWidth(stripAnsi(fitted))));
      return SELECTED_BG + fitted.replaceAll(RESET, RESET + SELECTED_BG) + fill + RESET;
    });
    if (rows.length === 0) lines.push(DIM + "（表示するものがありません。a で全 worktree を表示）" + RESET);
    while (lines.length < height) lines.push("");
    const help = `${DIM}Enter:移動 n:新規 R:再開 s:停止 x:セッション終了 a:${all ? "絞込" : "全部"} r:再読込 q:閉じる${RESET}`;
    const prompt = confirming ? `${ESC}[33m${confirming.question} y/N${RESET}` : message;
    out.write(CLEAR + frame([...header, ...lines, prompt, help], size, PADDING));
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
      usageHeader = usageLine(view.snap.usage, true);
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
      if (confirming) {
        const asked = confirming;
        confirming = null;
        if (k !== "y" && k !== "Y") return render();
        return void act(asked.run, false);
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
        case "x": {
          if (!isSelectable(r)) return;
          const path = r.worktree.path;
          confirming = {
            question: `${basename(path)} の tmux セッションを閉じますか？`,
            run: async () => {
              const res = await nav.closeSessionOf(path);
              return res.closed ? `閉じました: ${res.session}` : "tmux セッションはありません";
            },
          };
          return render();
        }
        case "s": {
          if (!r || r.kind !== "agent") return;
          const agent = r.agent;
          const verb = agent.alive ? "停止" : "削除";
          confirming = {
            question: `${agentDisplayName(agent)} を${verb}しますか？`,
            run: async () => {
              const res = await nav.core.stopAgent(agent.id);
              return res.stopped ? `${verb}しました: ${agentDisplayName(agent)}` : `${verb}できません: ${res.reason}`;
            },
          };
          return render();
        }
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
