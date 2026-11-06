import { View, div, type AsyncContext, type Context, type Element, type FocusHandle } from "gpui-kit";
import { exec, theme, watchFolder } from "herdr";
import { BRANCH_COLOR } from "../shared/colors";
import { readCurrentTarget } from "../shared/current-target";
import { relativeTime } from "../shared/relative-time";
import { hunkLink, iconButton, label, rowBase, statusColor, targetHeader, type Theme } from "../shared/row-view";
import { moveSelection } from "../shared/selection";
import type { Target } from "../shared/target";
import { stackTitleBar } from "../shared/stack-tabs";
import { footerBar, footerButton } from "../shared/footer-bar";
import { HEAD_ARGS, readLocalFiles, type FileChange } from "../shared/local-changes";
import { watchTmuxFocus } from "../shared/tmux-focus";
import { wsHunkAgainstArgs, wsHunkArgs, wsHunkRangeArgs } from "../shared/ws-hunk";
import { execWs } from "../shared/ws-exec";
import { GIT_READ_ARGS } from "@herdr-tools/utils/git-read-args";
import { branchLabel, commitFiles, compareRef, diffRange, logArgs, mergeBaseArgs, type HistoryRange, parseLog, showFilesArgs, type Commit } from "./git";
import { findBaseRef } from "./base-ref";
import { LOCAL_ID, visibleRows, type Row } from "./rows";

/** 予備の読み直しの間隔（ws list と git log・git status）。結果が前と同じなら再描画しない */
const REFRESH_MS = 5000;
const NO_TARGET_MESSAGE = "Select a tmux pane in a worktree";

export default class CommitHistory extends View {
  target!: Target | null;
  gitDirs!: string[];
  commits!: Commit[];
  range!: HistoryRange;
  noUpstream!: boolean;
  /** ベースブランチ（origin/main など）。分からなければ null */
  baseRef!: string | null;
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
    this.range = "all";
    this.noUpstream = false;
    this.baseRef = null;
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
    return exec("git", [...GIT_READ_ARGS, ...args], { cwd: root });
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
          const current = await readCurrentTarget(this.target);
          this.error = current.error;
          if (!current.error) {
            this.followTarget(current.target);
            if (this.target) await this.readGit(this.target.path, cx);
          }
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        } finally {
          this.fetching = false;
        }
        const snapshot = JSON.stringify([this.target, this.error, this.range, this.noUpstream, this.baseRef, this.commits, this.local, this.expanded, [...this.filesOf]]);
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
      this.baseRef = null;
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
        this.error = "Not a git repository";
        return;
      }
      const [gitDir = "", common = ""] = dirs.stdout.trim().split("\n");
      this.gitDirs = [...new Set([gitDir, common.startsWith("/") ? common : `${root}/${common}`])].filter(Boolean);
      this.watchGit(root, this.gitDirs, cx);
    }
    const range = this.range;
    if (this.baseRef === null) this.baseRef = await findBaseRef((args) => this.git(root, args), (args) => exec("gh", args, { cwd: root }));
    const args = logArgs(range, this.baseRef);
    const head = await this.git(root, HEAD_ARGS);
    const hasHead = head.code === 0;
    const [log, local] = await Promise.all([
      args ? this.git(root, args) : Promise.resolve({ code: 1, stdout: "", stderr: "" }),
      readLocalFiles((a) => this.git(root, a), hasHead),
    ]);
    if (this.target?.path !== root || this.range !== range) return;
    this.commits = hasHead && log.code === 0 ? parseLog(log.stdout) : [];
    this.noUpstream = range === "unpushed" && hasHead && log.code !== 0;
    this.local = local;
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
    this.runHunk(row.id, row.owner === LOCAL_ID ? null : row.owner, row.file, cx);
  }

  /** コミットのハッシュを押したら、そのコミット全体を hunk で開く（行は開閉しない） */
  openCommitInHunk(row: Extract<Row, { kind: "commit" }>, cx: Context) {
    this.runHunk(row.id, row.commit.hash, null, cx);
  }

  runHunk(rowId: string, commit: string | null, file: FileChange | null, cx: Context) {
    const root = this.target?.path;
    if (!root) return;
    this.selected = rowId;
    this.execHunk(wsHunkArgs(root, commit, file), cx);
  }

  /** 今の範囲で比べる相手のブランチ。比べる相手が無いとき（すべて・上流のブランチが無い・ベースブランチが分からない）は null */
  compareTarget() {
    if (this.range === "unpushed" && this.noUpstream) return null;
    return compareRef(this.range, this.baseRef);
  }

  /** コミットだけのブランチの差分を出せるか（比べる相手があり、コミットがある） */
  canOpenBranchDiff() {
    return this.compareTarget() !== null && this.commits.length > 0;
  }

  /** 未コミットの変更も含めたブランチの差分を出せるか（比べる相手があり、未コミットの変更がある。無ければコミットだけと同じなので出さない） */
  canOpenBranchDiffWithLocal() {
    return this.compareTarget() !== null && this.local.length > 0;
  }

  /** 比べる相手のブランチと HEAD の差分（分かれた点から。コミットだけ）を hunk で開く */
  openBranchDiff(cx: Context) {
    const root = this.target?.path;
    const range = this.compareTarget() ? diffRange(this.range, this.baseRef) : null;
    if (!root || !range) return;
    this.execHunk(wsHunkRangeArgs(root, range), cx);
  }

  /** 比べる相手のブランチから分かれた点と、作業ツリーの差分（未コミット・追跡されていないファイルも含む）を hunk で開く */
  openBranchDiffWithLocal(cx: Context) {
    const root = this.target?.path;
    const ref = this.compareTarget();
    if (!root || !ref) return;
    cx.spawn(
      async (cx) => {
        try {
          const base = await this.git(root, mergeBaseArgs(ref));
          const hash = base.stdout.trim();
          if (base.code !== 0 || !hash) {
            this.error = (base.stderr.trim() || `git merge-base: exit ${base.code}`);
            cx.notify();
            return;
          }
          if (this.target?.path === root) this.execHunk(wsHunkAgainstArgs(root, hash), cx);
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
          cx.notify();
        }
      },
      { owner: this },
    );
  }

  execHunk(args: string[], cx: Context) {
    cx.notify();
    cx.spawn(
      async (cx) => {
        this.error = (await execWs(args)).error;
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
        return rowBase(row.id, selected, t, 4)
          .on_click((_e, cx) => this.toggle(row, cx))
          .child(label(row.open ? "▾" : "▸", t.muted))
          .child(div().font_semibold().text_color(t.blocked).child("未コミットの変更"))
          .child(label(`${row.count} 個のファイル`, t.muted));
      case "commit": {
        const c = row.commit;
        return rowBase(row.id, selected, t, 4)
          .on_click((_e, cx) => this.toggle(row, cx))
          .child(label(row.open ? "▾" : "▸", t.muted))
          .child(hunkLink(`${row.id}:hash`, c.short, "このコミット全体を hunk で開く", t, (cx) => this.openCommitInHunk(row, cx)))
          .child(div().flex_1().min_w(0).truncate().child(c.subject))
          .children(this.refLabels(c.refs, t))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(c.author))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(relativeTime(now, c.time)));
      }
      case "file": {
        const f = row.file;
        const shown = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
        return rowBase(row.id, selected, t, 24)
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
    return targetHeader(this.target!, t)
      .child(div().flex_1())
      .when(this.canOpenBranchDiff(), (el) =>
        el.child(iconButton("commit-history:branch-diff", "mods/commit-history/diff.svg", `${this.compareLabel()} との差分（コミットだけ）を hunk で開く`, t, (cx) => this.openBranchDiff(cx))),
      )
      .when(this.canOpenBranchDiffWithLocal(), (el) =>
        el.child(
          iconButton("commit-history:branch-diff-local", "mods/commit-history/diff-local.svg", `${this.compareLabel()} との差分を、未コミットの変更も含めて hunk で開く`, t, (cx) =>
            this.openBranchDiffWithLocal(cx),
          ),
        ),
      );
  }

  compareLabel() {
    return this.range === "base" && this.baseRef ? branchLabel(this.baseRef) : "上流のブランチ";
  }

  /** 下端のフッター。コミットの範囲（すべて・push 前・ベースブランチ）を切り替えるボタンを置く */
  renderFooter(t: Theme) {
    return footerBar(t)
      .child(this.rangeButton("all", { icon: "mods/commit-history/history.svg", tooltip: "すべてのコミット（HEAD からの履歴）" }, t))
      .child(this.rangeButton("unpushed", { icon: "mods/commit-history/push.svg", tooltip: "push 前のコミット（上流のブランチにまだ無いもの）" }, t))
      .child(this.rangeButton("base", { text: this.baseRef ? branchLabel(this.baseRef) : "base" }, t));
  }

  rangeButton(range: HistoryRange, face: { text: string } | { icon: string; tooltip: string }, t: Theme) {
    return footerButton(`commit-history:range:${range}`, face, this.range === range, t, (cx) => this.switchRange(range, cx));
  }

  /** 範囲を切り替えたら、開いていたコミットを閉じてすぐ読み直す */
  switchRange(range: HistoryRange, cx: Context) {
    if (this.range === range) return;
    this.range = range;
    this.commits = [];
    this.noUpstream = false;
    // ベースは選ぶたびに調べ直す（mod を開いた後に作ったプルリクエストの base も拾う）
    if (range === "base") this.baseRef = null;
    if (this.expanded !== LOCAL_ID) this.expanded = null;
    cx.notify();
    this.refresh(cx);
  }

  emptyMessage() {
    if (this.range === "all") return "No commits";
    if (this.range === "base") return this.baseRef ? `No commits since ${branchLabel(this.baseRef)}` : "No base branch";
    return this.noUpstream ? "No upstream branch" : "No unpushed commits";
  }

  render() {
    const t = theme() as unknown as Theme;
    const rows = visibleRows(this.commits, this.local, this.expanded, this.filesOf);
    const now = Math.floor(Date.now() / 1000);
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
              .id("commit-history:list")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .when(this.commits.length === 0 && this.error === "", (el) => el.child(label(this.emptyMessage(), t.muted)))
              .children(rows.map((r) => this.renderRow(r, t, now))),
          )
          .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1))),
      );
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
      .text_size(13)
      .text_color(t.foreground)
      .child(stackTitleBar("commit-history", `${this.commits.length} commits`, t))
      .child(body)
      .child(this.renderFooter(t));
  }
}
