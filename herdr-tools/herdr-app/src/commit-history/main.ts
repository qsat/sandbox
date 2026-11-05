import { View, div, type AsyncContext, type Color, type Context, type Element, type FocusHandle } from "gpui-kit";
import { exec, theme, watchFolder } from "herdr";
import { BRANCH_COLOR, REPOSITORY_COLOR, SELECTED_BG } from "../shared/colors";
import { watchTmuxFocus } from "../shared/tmux-focus";
import { parseList, WS } from "../shared/ws-list";
import { LOG_ARGS, READ, commitFiles, localFiles, parseLog, relativeTime, showFilesArgs, sumNumstat, wsHunkArgs, type Commit, type FileChange } from "./git";
import { LOCAL_ID, moveSelection, visibleRows, type Row } from "./rows";
import { resolveTarget, type Target } from "./target";

/** 予備の読み直しの間隔（ws list と git log・git status）。結果が前と同じなら再描画しない */
const REFRESH_MS = 5000;
const ROW_HEIGHT = 22;
const NO_TARGET_MESSAGE = "tmux で worktree の中のペインを選ぶと、その履歴が出ます";

type Theme = Record<"foreground" | "muted" | "dim" | "accent" | "raised" | "hover" | "background" | "blocked" | "ansi1" | "ansi2", Color>;

function label(text: string, color: Color) {
  return div().text_color(color).child(text);
}

function statusColor(t: Theme, status: string) {
  return status === "A" || status === "?" ? t.ansi2 : status === "D" || status === "U" ? t.ansi1 : status === "R" ? t.accent : t.blocked;
}

export default class CommitHistory extends View {
  target!: Target | null;
  gitDirs!: string[];
  commits!: Commit[];
  local!: FileChange[];
  filesOf!: Map<string, FileChange[]>;
  expanded!: string | null;
  selected!: string | null;
  error!: string;
  fetching!: boolean;
  dirty!: boolean;
  snapshot!: string;
  watchGeneration!: number;
  focus!: FocusHandle;

  init(_props: unknown, cx: AsyncContext) {
    this.target = null;
    this.gitDirs = [];
    this.commits = [];
    this.local = [];
    this.filesOf = new Map();
    this.expanded = null;
    this.selected = null;
    this.error = "";
    this.fetching = false;
    this.dirty = false;
    this.snapshot = "";
    this.watchGeneration = 0;
    this.focus = cx.focus_handle();
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
    // tmux で今いるペインが変わったらすぐ読み直す（未コミットの変更の読み直しもここ）
    watchTmuxFocus(cx, this, (cx) => this.refresh(cx));
  }

  git(root: string, args: string[]) {
    return exec("git", [...READ, ...args], { cwd: root });
  }

  /** ws list --json で今いるペインの worktree を決め、その git の状態を読む。結果が前と同じなら再描画しない */
  refresh(cx: Context) {
    if (this.fetching) {
      this.dirty = true;
      return;
    }
    this.fetching = true;
    cx.spawn(
      async (cx) => {
        try {
          const r = await exec(WS, ["list", "--json"]);
          if (r.code !== 0) this.error = (r.stderr || `ws list: exit ${r.code}`).trim();
          else {
            this.error = "";
            this.followTarget(resolveTarget(parseList(r.stdout), this.target));
            if (this.target) await this.readGit(this.target.path, cx);
          }
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        } finally {
          this.fetching = false;
        }
        const snapshot = JSON.stringify([this.target, this.error, this.commits, this.local, this.expanded, [...this.filesOf]]);
        if (snapshot !== this.snapshot) {
          this.snapshot = snapshot;
          cx.notify();
        }
        if (this.dirty) {
          this.dirty = false;
          this.refresh(cx);
        }
      },
      { owner: this },
    );
  }

  /** 見る worktree が変わったら、前の worktree の表示を捨てる */
  followTarget(next: Target | null) {
    if (next?.path !== this.target?.path) {
      this.gitDirs = [];
      this.commits = [];
      this.local = [];
      this.filesOf = new Map();
      this.expanded = null;
      this.selected = null;
    }
    this.target = next;
  }

  async readGit(root: string, cx: Context) {
    if (this.gitDirs.length === 0) {
      const dirs = await this.git(root, ["rev-parse", "--absolute-git-dir", "--git-common-dir"]);
      if (this.target?.path !== root) return;
      if (dirs.code !== 0) {
        this.error = "git リポジトリではありません";
        return;
      }
      const [gitDir = "", common = ""] = dirs.stdout.trim().split("\n");
      this.gitDirs = [...new Set([gitDir, common.startsWith("/") ? common : `${root}/${common}`])].filter(Boolean);
      this.watchGit(root, this.gitDirs, cx);
    }
    const [log, head, status] = await Promise.all([
      this.git(root, LOG_ARGS),
      this.git(root, ["rev-parse", "--verify", "HEAD"]),
      this.git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ]);
    const hasHead = head.code === 0;
    const numstats = hasHead
      ? [await this.git(root, ["diff", "HEAD", "--numstat", "-z", "--no-renames"])]
      : [await this.git(root, ["diff", "--cached", "--numstat", "-z", "--no-renames"]), await this.git(root, ["diff", "--numstat", "-z", "--no-renames"])];
    if (this.target?.path !== root) return;
    this.commits = hasHead && log.code === 0 ? parseLog(log.stdout) : [];
    this.local = status.code === 0 ? localFiles(status.stdout, sumNumstat(...numstats.map((n) => n.stdout))) : [];
    if (this.expanded === LOCAL_ID && this.local.length === 0) this.expanded = null;
  }

  /**
   * 新しいコミット（HEAD や refs の変化）を、git のディレクトリの見張りですぐ知る。
   * 作業ツリー全体は見張らない（重い）ので、未コミットの変更は定期の読み直しと tmux のペインの変化で読む。
   * 見張りが失敗しても（見張れないなど）mod は壊さず、定期の読み直しだけで動く
   */
  watchGit(root: string, dirs: string[], cx: Context) {
    const generation = ++this.watchGeneration;
    for (const dir of dirs) {
      cx.spawn(
        async (cx) => {
          try {
            while (this.watchGeneration === generation && this.target?.path === root) {
              await watchFolder(dir);
              if (this.watchGeneration === generation) this.refresh(cx);
            }
          } catch {
            // 定期の読み直しがあるので、何もしない
          }
        },
        { owner: this },
      );
    }
  }

  toggle(row: Extract<Row, { kind: "local" | "commit" }>, cx: Context) {
    const key = row.kind === "local" ? LOCAL_ID : row.commit.hash;
    this.selected = row.id;
    this.expanded = this.expanded === key ? null : key;
    if (this.expanded && row.kind === "commit" && !this.filesOf.has(key)) this.loadFiles(row.commit.hash, cx);
    cx.notify();
  }

  loadFiles(hash: string, cx: Context) {
    const root = this.target?.path;
    if (!root) return;
    cx.spawn(
      async (cx) => {
        try {
          const [names, stats] = await Promise.all([this.git(root, showFilesArgs(hash, "name-status")), this.git(root, showFilesArgs(hash, "numstat"))]);
          if (this.target?.path !== root) return;
          if (names.code !== 0) this.error = names.stderr.trim();
          else this.filesOf.set(hash, commitFiles(names.stdout, stats.stdout));
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        }
        cx.notify();
      },
      { owner: this },
    );
  }

  /** ファイルの差分を hunk で開く（`ws hunk`。コミットの下なら hunk show、未コミットなら hunk diff） */
  openInHunk(row: Extract<Row, { kind: "file" }>, cx: Context) {
    const root = this.target?.path;
    if (!root) return;
    this.selected = row.id;
    cx.notify();
    cx.spawn(
      async (cx) => {
        try {
          const r = await exec(WS, wsHunkArgs(root, row.owner === LOCAL_ID ? null : row.owner, row.file));
          this.error = r.code !== 0 ? (r.stderr.trim() || `ws hunk: exit ${r.code}`) : "";
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        }
        cx.notify();
      },
      { owner: this },
    );
  }

  act(row: Row, cx: Context) {
    if (row.kind === "file") this.openInHunk(row, cx);
    else this.toggle(row, cx);
  }

  onKey(keystroke: string, rows: Row[], cx: Context) {
    if (keystroke === "j" || keystroke === "down" || keystroke === "k" || keystroke === "up") {
      this.selected = moveSelection(rows, this.selected, keystroke === "j" || keystroke === "down" ? 1 : -1);
      cx.notify();
      return true;
    }
    const row = keystroke === "enter" ? rows.find((r) => r.id === this.selected) : undefined;
    if (!row) return false;
    this.act(row, cx);
    return true;
  }

  rowBase(id: string, selected: boolean, t: Theme, indent: number) {
    return div()
      .id(id)
      .flex()
      .items_center()
      .gap(8)
      .min_h(ROW_HEIGHT)
      .pl(indent)
      .pr(4)
      .rounded(6)
      .cursor_pointer()
      .overflow_hidden()
      .whitespace_nowrap()
      .when(selected, (el) => el.bg(SELECTED_BG))
      .hover((s) => s.bg(t.hover));
  }

  refLabels(refs: string[], t: Theme) {
    return refs.map((ref) => {
      const tag = ref.startsWith("tag: ");
      const text = tag ? ref : ref.replace("HEAD -> ", "");
      return div().flex_none().text_size(11).text_color(tag ? t.accent : BRANCH_COLOR).child(`[${text}]`);
    });
  }

  renderRow(row: Row, t: Theme, now: number): Element {
    const selected = row.id === this.selected;
    switch (row.kind) {
      case "local":
        return this.rowBase(row.id, selected, t, 4)
          .on_click((_e, cx) => this.toggle(row, cx))
          .child(label(row.open ? "▾" : "▸", t.muted))
          .child(div().font_semibold().text_color(t.blocked).child("未コミットの変更"))
          .child(label(`${row.count} 個のファイル`, t.muted));
      case "commit": {
        const c = row.commit;
        return this.rowBase(row.id, selected, t, 4)
          .on_click((_e, cx) => this.toggle(row, cx))
          .child(label(row.open ? "▾" : "▸", t.muted))
          .child(div().flex_none().text_color(t.accent).child(c.short))
          .child(div().flex_1().min_w(0).truncate().child(c.subject))
          .children(this.refLabels(c.refs, t))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(c.author))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(relativeTime(now, c.time)));
      }
      case "file": {
        const f = row.file;
        const shown = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
        return this.rowBase(row.id, selected, t, 24)
          .on_click((_e, cx) => this.openInHunk(row, cx))
          .tooltip("hunk で差分を開く（Enter）")
          .child(div().flex_none().w(12).text_color(statusColor(t, f.status)).child(f.status))
          .child(div().flex_1().min_w(0).truncate().child(shown))
          .when(f.binary, (el) => el.child(label("バイナリ", t.dim)))
          .when(!f.binary && f.add > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
          .when(!f.binary && f.del > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      }
    }
  }

  renderHeader(t: Theme) {
    const target = this.target!;
    return div()
      .flex()
      .items_center()
      .gap(8)
      .min_h(ROW_HEIGHT)
      .px(4)
      .overflow_hidden()
      .whitespace_nowrap()
      .child(div().font_semibold().text_color(REPOSITORY_COLOR).child(target.workspace))
      .child(div().text_color(BRANCH_COLOR).child(target.label))
      .when(target.branch !== null && target.branch !== target.label, (el) => el.child(label(target.branch!, t.muted)));
  }

  render() {
    const t = theme() as unknown as Theme;
    const rows = visibleRows(this.commits, this.local, this.expanded, this.filesOf);
    const now = Math.floor(Date.now() / 1000);
    return div()
      .id("commit-history")
      .track_focus(this.focus)
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((e, cx) => {
        if (this.onKey(e.keystroke, rows, cx)) cx.stop_propagation();
      })
      .size_full()
      .flex()
      .flex_col()
      .line_height(1.25)
      .p(8)
      .text_size(13)
      .text_color(t.foreground)
      .when(this.target === null, (el) => el.child(label(this.error || NO_TARGET_MESSAGE, this.error ? t.ansi1 : t.muted)))
      .when(this.target !== null, (el) =>
        el
          .child(this.renderHeader(t))
          .child(
            div()
              .id("commit-history:list")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .when(rows.length === 0 && this.error === "", (el) => el.child(label("コミットがありません", t.muted)))
              .children(rows.map((r) => this.renderRow(r, t, now))),
          )
          .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1))),
      );
  }
}
