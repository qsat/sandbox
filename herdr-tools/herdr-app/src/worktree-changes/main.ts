import { View, div, type AsyncContext, type Context, type FocusHandle } from "gpui-kit";
import { exec, theme } from "herdr";
import { readCurrentTarget } from "../shared/current-target";
import { footerBar, footerButton } from "../shared/footer-bar";
import { HEAD_ARGS, readLocalFiles, type FileChange } from "../shared/local-changes";
import { iconButton, label, rowBase, statusColor, targetHeader, type Theme } from "../shared/row-view";
import { moveSelection } from "../shared/selection";
import { stackTitleBar } from "../shared/stack-tabs";
import type { Target } from "../shared/target";
import { watchTmuxFocus } from "../shared/tmux-focus";
import { execWs } from "../shared/ws-exec";
import { wsEditArgs } from "../shared/ws-edit";
import { GIT_READ_ARGS } from "@herdr-tools/utils/git-read-args";
import { changeRows, dirPaths, type Row, type ViewMode } from "./rows";

/** 予備の読み直しの間隔（ws list と git status）。結果が前と同じなら再描画しない */
const REFRESH_MS = 5000;
const NO_TARGET_MESSAGE = "Select a tmux pane in a worktree";
/** ツリーの 1 段ぶんの字下げ（px） */
const INDENT = 14;

export default class WorktreeChanges extends View {
  target!: Target | null;
  files!: FileChange[];
  mode!: ViewMode;
  /** 閉じているフォルダーのパス */
  collapsed!: Set<string>;
  selected!: string | null;
  error!: string;
  fetching!: boolean;
  dirty!: boolean;
  snapshot!: string;
  focus!: FocusHandle;

  init(_props: unknown, cx: AsyncContext) {
    this.target = null;
    this.files = [];
    this.mode = "tree";
    this.collapsed = new Set();
    this.selected = null;
    this.error = "";
    this.fetching = false;
    this.dirty = false;
    this.snapshot = "";
    this.focus = cx.focus_handle();
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
    // tmux で今いるペインが変わったらすぐ読み直す
    watchTmuxFocus(cx, this, (cx) => this.refresh(cx));
  }

  git(root: string, args: string[]) {
    return exec("git", [...GIT_READ_ARGS, ...args], { cwd: root });
  }

  /** ws list --json で今いるペインの worktree を決め、未コミットの変更を読む。結果が前と同じなら再描画しない */
  refresh(cx: Context) {
    if (this.fetching) {
      this.dirty = true;
      return;
    }
    this.fetching = true;
    cx.spawn(
      async (cx) => {
        try {
          const current = await readCurrentTarget(this.target);
          this.error = current.error;
          if (!current.error) {
            this.followTarget(current.target);
            if (this.target) await this.readFiles(this.target.path);
          }
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        } finally {
          this.fetching = false;
        }
        const snapshot = JSON.stringify([this.target, this.error, this.mode, this.files, [...this.collapsed]]);
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
      this.files = [];
      this.collapsed = new Set();
      this.selected = null;
    }
    this.target = next;
  }

  async readFiles(root: string) {
    const git = (args: string[]) => this.git(root, args);
    const head = await git(HEAD_ARGS);
    if (head.code !== 0 && (await git(["rev-parse", "--git-dir"])).code !== 0) {
      this.error = "Not a git repository";
      return;
    }
    const files = await readLocalFiles(git, head.code === 0);
    if (this.target?.path === root) this.files = files;
  }

  /** ファイルを $EDITOR で開く（`ws edit`。tmux の新しいウィンドウで起動し、クライアントをそこへ移す） */
  edit(row: Extract<Row, { kind: "file" }>, cx: Context) {
    const root = this.target?.path;
    if (!root) return;
    this.selected = row.id;
    cx.notify();
    cx.spawn(
      async (cx) => {
        this.error = (await execWs(wsEditArgs(root, row.file))).error;
        cx.notify();
      },
      { owner: this },
    );
  }

  toggleDir(row: Extract<Row, { kind: "dir" }>, cx: Context) {
    this.selected = row.id;
    if (!this.collapsed.delete(row.path)) this.collapsed.add(row.path);
    cx.notify();
  }

  /** ツリーのフォルダーをすべて開く */
  expandAll(cx: Context) {
    this.collapsed = new Set();
    cx.notify();
  }

  /** ツリーのフォルダーをすべて閉じる（いま出ているフォルダーだけ。あとで増えたフォルダーは開いて出る） */
  collapseAll(cx: Context) {
    this.collapsed = new Set(dirPaths(this.files));
    cx.notify();
  }

  /** リポジトリ名の行。ツリー表示のときは、右端に「すべて開く」「すべて閉じる」のアイコンボタンを置く */
  renderHeader(t: Theme) {
    return targetHeader(this.target!, t)
      .child(div().flex_1())
      .when(this.mode === "tree" && this.files.length > 0, (el) =>
        el
          .child(iconButton("worktree-changes:expand-all", "mods/worktree-changes/expand-all.svg", "すべて開く", t, (cx) => this.expandAll(cx)))
          .child(iconButton("worktree-changes:collapse-all", "mods/worktree-changes/collapse-all.svg", "すべて閉じる", t, (cx) => this.collapseAll(cx))),
      );
  }

  switchMode(mode: ViewMode, cx: Context) {
    if (this.mode === mode) return;
    this.mode = mode;
    cx.notify();
  }

  act(row: Row, cx: Context) {
    if (row.kind === "file") this.edit(row, cx);
    else this.toggleDir(row, cx);
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

  renderRow(row: Row, t: Theme) {
    const selected = row.id === this.selected;
    const indent = 4 + row.depth * INDENT;
    if (row.kind === "dir") {
      return rowBase(row.id, selected, t, indent)
        .on_click((_e, cx) => this.toggleDir(row, cx))
        .child(label(row.open ? "▾" : "▸", t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(row.name))
        .child(label(String(row.count), t.dim));
    }
    const f = row.file;
    return rowBase(row.id, selected, t, indent + (this.mode === "tree" ? 12 : 0))
      .on_click((_e, cx) => this.edit(row, cx))
      .tooltip("$EDITOR で開く（Enter）")
      .child(div().flex_none().w(12).text_color(statusColor(t, f.status)).child(f.status))
      .child(div().flex_1().min_w(0).truncate().child(row.name))
      .when(f.binary, (el) => el.child(label("バイナリ", t.dim)))
      .when(!f.binary && f.add > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(!f.binary && f.del > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  /** 下端のフッター。表示を「ツリー」と「フラット」で切り替えるボタンを置く */
  renderFooter(t: Theme) {
    return footerBar(t)
      .child(footerButton("worktree-changes:mode:tree", { text: "Tree" }, this.mode === "tree", t, (cx) => this.switchMode("tree", cx)))
      .child(footerButton("worktree-changes:mode:flat", { text: "Flat" }, this.mode === "flat", t, (cx) => this.switchMode("flat", cx)));
  }

  render() {
    const t = theme() as unknown as Theme;
    const rows = changeRows(this.files, this.mode, this.collapsed);
    const body = div()
      .flex()
      .flex_col()
      .flex_1()
      .min_h(0)
      .p(8)
      .when(this.target === null, (el) => el.child(label(this.error || NO_TARGET_MESSAGE, this.error ? t.ansi1 : t.muted)))
      .when(this.target !== null, (el) =>
        el
          .child(this.renderHeader(t))
          .child(
            div()
              .id("worktree-changes:list")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .when(this.files.length === 0 && this.error === "", (el) => el.child(label("No changes", t.muted)))
              .children(rows.map((r) => this.renderRow(r, t))),
          )
          .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1))),
      );
    return div()
      .id("worktree-changes")
      .track_focus(this.focus)
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((e, cx) => {
        if (this.onKey(e.keystroke, rows, cx)) cx.stop_propagation();
      })
      .size_full()
      .flex()
      .flex_col()
      .line_height(1.25)
      .text_size(13)
      .text_color(t.foreground)
      .child(stackTitleBar("worktree-changes", `${this.files.length} files`, t))
      .child(body)
      .child(this.renderFooter(t));
  }
}
