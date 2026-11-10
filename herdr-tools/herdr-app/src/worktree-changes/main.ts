import { View, div, type AsyncContext, type Context, type FocusHandle } from "gpui-kit";
import { exec, theme } from "herdr";
import { readCurrentTarget } from "../shared/current-target";
import { shownError } from "../shared/errors";
import { footerBar, footerButton } from "../shared/footer-bar";
import { branchLabel, compareRef, findBaseRef } from "../shared/base-ref";
import { HEAD_ARGS, readLocalFiles, readRangeFiles, type FileChange } from "../shared/local-changes";
import { iconButton, label, rowBase, statusColor, targetHeader, type Theme } from "../shared/row-view";
import { moveSelection } from "../shared/selection";
import { stackTitleBar } from "../shared/stack-tabs";
import type { Target } from "../shared/target";
import { watchTmuxFocus } from "../shared/tmux-focus";
import { execWs } from "../shared/ws-exec";
import { editBlockedReason, wsEditArgs } from "../shared/ws-edit";
import { GIT_READ_ARGS } from "@herdr-tools/utils/git-read-args";
import { changeRows, dirPaths, emptyMessage, type ChangeRange, type Row, type ViewMode } from "./rows";

/** 予備の読み直しの間隔（ws list と git status）。結果が前と同じなら再描画しない */
const REFRESH_MS = 5000;
const NO_TARGET_MESSAGE = "Select a tmux pane in a worktree";
/** ツリーの 1 段ぶんの字下げ（px） */
const INDENT = 14;

export default class WorktreeChanges extends View {
  target!: Target | null;
  files!: FileChange[];
  mode!: ViewMode;
  range!: ChangeRange;
  /** ベースブランチ（origin/main など）。分からなければ null */
  baseRef!: string | null;
  /** 今の worktree のベースブランチを調べ終えたか（見つからなかったときも true。調べ直すのは worktree が変わったときと、ベースからの範囲を選んだとき） */
  baseKnown!: boolean;
  /** 範囲 unpushed・base で、比べる相手のブランチが無い（上流のブランチ・ベースブランチが無い） */
  noCompare!: boolean;
  /** 閉じているフォルダーのパス */
  collapsed!: Set<string>;
  selected!: string | null;
  /** 読み直し（ws list・git）の失敗。読み直すたびに入れ替わる */
  error!: string;
  /** 操作（ファイルを $EDITOR で開く）の失敗。読み直しでは消さず、次の操作まで残す */
  actionError!: string;
  fetching!: boolean;
  dirty!: boolean;
  snapshot!: string;
  focus!: FocusHandle;

  init(_props: unknown, cx: AsyncContext) {
    this.target = null;
    this.files = [];
    this.mode = "tree";
    this.range = "head";
    this.baseRef = null;
    this.baseKnown = false;
    this.noCompare = false;
    this.collapsed = new Set();
    this.selected = null;
    this.error = "";
    this.actionError = "";
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
        const snapshot = JSON.stringify([this.target, this.error, this.mode, this.range, this.baseRef, this.noCompare, this.files, [...this.collapsed]]);
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
      this.baseRef = null;
      this.baseKnown = false;
      this.noCompare = false;
      this.collapsed = new Set();
      this.selected = null;
    }
    this.target = next;
  }

  async readFiles(root: string) {
    const git = (args: string[]) => this.git(root, args);
    const range = this.range;
    const head = await git(HEAD_ARGS);
    const hasHead = head.code === 0;
    if (!hasHead && (await git(["rev-parse", "--git-dir"])).code !== 0) {
      this.error = "Not a git repository";
      return;
    }
    let files: FileChange[] | null;
    if (range === "head") {
      files = await readLocalFiles(git, hasHead);
    } else {
      // 見つからなくても調べ終えたことにして、読み直しのたびに gh（GitHub への問い合わせ）を呼ばない
      if (range === "base" && !this.baseKnown) {
        this.baseRef = await findBaseRef(git, (args) => exec("gh", args, { cwd: root }));
        this.baseKnown = true;
      }
      const ref = compareRef(range, this.baseRef);
      files = hasHead && ref ? await readRangeFiles(git, ref) : null;
    }
    if (this.target?.path !== root || this.range !== range) return;
    this.noCompare = files === null;
    this.files = files ?? [];
  }

  /** ファイルを $EDITOR で開く（`ws edit`。tmux の新しいウィンドウで起動し、クライアントをそこへ移す） */
  edit(row: Extract<Row, { kind: "file" }>, cx: Context) {
    const root = this.target?.path;
    if (!root) return;
    this.selected = row.id;
    const blocked = editBlockedReason(row.file);
    if (blocked) {
      this.actionError = blocked;
      cx.notify();
      return;
    }
    cx.notify();
    cx.spawn(
      async (cx) => {
        this.actionError = (await execWs(wsEditArgs(root, row.file))).error;
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

  /** 本文の一番上の行。表示を「ツリー」と「フラット」で切り替えるボタンを置く */
  renderModeBar(t: Theme) {
    return div()
      .flex()
      .flex_none()
      .items_center()
      .gap(4)
      .px(4)
      .pb(4)
      .child(footerButton("worktree-changes:mode:tree", { text: "Tree" }, this.mode === "tree", t, (cx) => this.switchMode("tree", cx)))
      .child(footerButton("worktree-changes:mode:flat", { text: "Flat" }, this.mode === "flat", t, (cx) => this.switchMode("flat", cx)));
  }

  switchMode(mode: ViewMode, cx: Context) {
    if (this.mode === mode) return;
    this.mode = mode;
    cx.notify();
  }

  /** 範囲を切り替えたら、前の範囲の表示を捨ててすぐ読み直す（ベースブランチは選ぶたびに調べ直す。mod を開いた後に作ったプルリクエストの base も拾う） */
  switchRange(range: ChangeRange, cx: Context) {
    if (this.range === range) return;
    this.range = range;
    this.files = [];
    this.noCompare = false;
    this.error = "";
    this.actionError = "";
    if (range === "base") {
      this.baseRef = null;
      this.baseKnown = false;
    }
    cx.notify();
    this.refresh(cx);
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

  /** 下端のフッター。出す変更の範囲（未コミット・push 前・ベースから）を切り替えるボタンを置く */
  renderFooter(t: Theme) {
    return footerBar(t)
      .child(this.rangeButton("head", "未コミット", t))
      .child(this.rangeButton("unpushed", "push 前", t))
      .child(this.rangeButton("base", this.baseRef ? branchLabel(this.baseRef) : "base", t));
  }

  rangeButton(range: ChangeRange, text: string, t: Theme) {
    return footerButton(`worktree-changes:range:${range}`, { text }, this.range === range, t, (cx) => this.switchRange(range, cx));
  }

  render() {
    const t = theme() as unknown as Theme;
    const rows = changeRows(this.files, this.mode, this.collapsed);
    const error = shownError(this.error, this.actionError);
    const body = div()
      .flex()
      .flex_col()
      .flex_1()
      .min_h(0)
      .p(8)
      .when(this.target === null, (el) => el.child(label(this.error || NO_TARGET_MESSAGE, this.error ? t.ansi1 : t.muted)))
      .when(this.target !== null, (el) =>
        el
          .child(this.renderModeBar(t))
          .child(this.renderHeader(t))
          .child(
            div()
              .id("worktree-changes:list")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .when(this.files.length === 0 && this.error === "", (el) => el.child(label(emptyMessage(this.range, this.noCompare, this.baseRef ? branchLabel(this.baseRef) : null), t.muted)))
              .children(rows.map((r) => this.renderRow(r, t))),
          )
          .when(error !== "", (el) => el.child(label(error, t.ansi1))),
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
