import { View, div, type AsyncContext, type Context, type Element, type FocusHandle } from "gpui-kit";
import { exec, theme } from "herdr";
import { BRANCH_COLOR, REPOSITORY_COLOR } from "../shared/colors";
import { relativeTime } from "../shared/relative-time";
import { ROW_HEIGHT, hunkLink, label, rowBase, type Theme } from "../shared/row-view";
import { moveSelection } from "../shared/selection";
import { resolveTarget, type Target } from "../shared/target";
import { TITLE_BAR_HEIGHT } from "../shared/title-bar";
import { countBadge, stackTabs } from "../shared/stack-tabs";
import { watchTmuxFocus } from "../shared/tmux-focus";
import { wsHunkPrArgs, wsHunkPrCommitArgs } from "../shared/ws-hunk";
import { parseList, WS } from "../shared/ws-list";
import { NO_PULL_REQUESTS_MESSAGE, PR_LIST_ARGS, ghFailureMessage, parsePrCommits, parsePrList, prCommitsArgs, type PrCommit, type PullRequest } from "./gh";
import { visibleRows, type Row } from "./rows";

/** ws list の読み直しの間隔（今いるペインの worktree に追従するため）。gh は呼ばない */
const FOLLOW_MS = 5000;
/** gh（GitHub への問い合わせ）の読み直しの間隔 */
const PR_REFRESH_MS = 60000;
const NO_TARGET_MESSAGE = "tmux で worktree の中のペインを選ぶと、そのリポジトリのプルリクエストが出ます";

export default class PullRequests extends View {
  target!: Target | null;
  /** プルリクエストを読んだ worktree。target と違えば読み直す */
  prsFor!: string | null;
  prs!: PullRequest[] | null;
  /** プルリクエストの一覧の代わりに出す文（gh が失敗した・0 件のとき）。出さないときは空 */
  message!: string;
  commitsOf!: Map<number, PrCommit[]>;
  expanded!: number | null;
  selected!: string | null;
  error!: string;
  fetchingList!: boolean;
  fetchingPrs!: boolean;
  dirty!: boolean;
  snapshot!: string;
  focus!: FocusHandle;

  init(_props: unknown, cx: AsyncContext) {
    this.target = null;
    this.prsFor = null;
    this.prs = null;
    this.message = "";
    this.commitsOf = new Map();
    this.expanded = null;
    this.selected = null;
    this.error = "";
    this.fetchingList = false;
    this.fetchingPrs = false;
    this.dirty = false;
    this.snapshot = "";
    this.focus = cx.focus_handle();
    cx.timer.every(FOLLOW_MS, (cx) => this.follow(cx));
    cx.timer.every(PR_REFRESH_MS, (cx) => this.loadPrs(cx));
    this.follow(cx);
    watchTmuxFocus(cx, this, (cx) => this.follow(cx));
  }

  /** 結果が前と同じなら再描画しない */
  repaint(cx: Context) {
    const snapshot = JSON.stringify([this.target, this.error, this.prs, this.message, this.expanded, [...this.commitsOf]]);
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    cx.notify();
  }

  /** ws list --json で今いるペインの worktree を決める。worktree が変わったら、プルリクエストを読み直す */
  follow(cx: Context) {
    if (this.fetchingList) {
      this.dirty = true;
      return;
    }
    this.fetchingList = true;
    cx.spawn(
      async (cx) => {
        try {
          const r = await exec(WS, ["list", "--json"]);
          if (r.code !== 0) this.error = (r.stderr || `ws list: exit ${r.code}`).trim();
          else {
            this.error = "";
            this.followTarget(resolveTarget(parseList(r.stdout), this.target));
          }
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        } finally {
          this.fetchingList = false;
        }
        this.repaint(cx);
        if (this.target && this.prsFor !== this.target.path) this.loadPrs(cx);
        if (this.dirty) {
          this.dirty = false;
          this.follow(cx);
        }
      },
      { owner: this },
    );
  }

  /** 見る worktree が変わったら、前の worktree の表示を捨てる */
  followTarget(next: Target | null) {
    if (next?.path !== this.target?.path) {
      this.prsFor = null;
      this.prs = null;
      this.message = "";
      this.commitsOf = new Map();
      this.expanded = null;
      this.selected = null;
    }
    this.target = next;
  }

  /** gh pr list で開いているプルリクエストを読む。開いているプルリクエストがあれば、そのコミットも読み直す。gh の失敗では mod を壊さず、一覧の代わりに理由を出す */
  loadPrs(cx: Context) {
    const root = this.target?.path;
    if (!root || this.fetchingPrs) return;
    this.fetchingPrs = true;
    this.prsFor = root;
    cx.spawn(
      async (cx) => {
        try {
          const r = await exec("gh", PR_LIST_ARGS, { cwd: root }).catch(() => null);
          if (this.target?.path === root) {
            if (r && r.code === 0) {
              this.prs = parsePrList(r.stdout);
              this.message = this.prs.length === 0 ? NO_PULL_REQUESTS_MESSAGE : "";
              if (this.expanded !== null) {
                if (this.prs.some((p) => p.number === this.expanded)) await this.readCommits(root, this.expanded);
                else this.expanded = null;
              }
            } else {
              this.prs = [];
              this.message = ghFailureMessage(r);
            }
          }
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        } finally {
          this.fetchingPrs = false;
        }
        this.repaint(cx);
        if (this.target && this.prsFor !== this.target.path) this.loadPrs(cx);
      },
      { owner: this },
    );
  }

  async readCommits(root: string, number: number) {
    const r = await exec("gh", prCommitsArgs(number), { cwd: root }).catch(() => null);
    if (this.target?.path !== root) return;
    if (r && r.code === 0) this.commitsOf.set(number, parsePrCommits(r.stdout));
    else this.commitsOf.set(number, []);
  }

  toggle(row: Extract<Row, { kind: "pr" }>, cx: Context) {
    const number = row.pr.number;
    this.selected = row.id;
    this.expanded = this.expanded === number ? null : number;
    const root = this.target?.path;
    if (this.expanded !== null && root && !this.commitsOf.has(number)) {
      cx.spawn(
        async (cx) => {
          try {
            await this.readCommits(root, number);
          } catch (e) {
            this.error = String((e as Error)?.message ?? e);
          }
          this.repaint(cx);
        },
        { owner: this },
      );
    }
    cx.notify();
  }

  /** `ws hunk` を呼ぶ。resolveArgs は非同期で ws hunk の引数を決める（コミットが手元にあるかを調べるため） */
  runHunk(rowId: string, resolveArgs: (root: string) => Promise<string[]>, cx: Context) {
    const root = this.target?.path;
    if (!root) return;
    this.selected = rowId;
    cx.notify();
    cx.spawn(
      async (cx) => {
        try {
          const r = await exec(WS, await resolveArgs(root));
          this.error = r.code !== 0 ? (r.stderr.trim() || `ws hunk: exit ${r.code}`) : "";
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        }
        cx.notify();
      },
      { owner: this },
    );
  }

  /** プルリクエスト全体の差分を hunk で開く（hunk gh pr） */
  openPrInHunk(row: Extract<Row, { kind: "pr" }>, cx: Context) {
    this.runHunk(row.id, async (root) => wsHunkPrArgs(root, row.pr.number), cx);
  }

  /** コミットの差分を hunk で開く。手元にあれば hunk show、無ければ hunk gh commit */
  openCommitInHunk(row: Extract<Row, { kind: "commit" }>, cx: Context) {
    this.runHunk(
      row.id,
      async (root) => {
        const sha = row.commit.hash;
        const found = await exec("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root });
        return wsHunkPrCommitArgs(root, sha, found.code === 0);
      },
      cx,
    );
  }

  act(row: Row, cx: Context) {
    if (row.kind === "pr") this.toggle(row, cx);
    else if (row.kind === "commit") this.openCommitInHunk(row, cx);
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

  renderRow(row: Row, t: Theme, now: number): Element {
    const selected = row.id === this.selected;
    switch (row.kind) {
      case "pr": {
        const p = row.pr;
        return rowBase(row.id, selected, t, 4)
          .on_click((_e, cx) => this.toggle(row, cx))
          .child(label(row.open ? "▾" : "▸", t.muted))
          .child(hunkLink(`${row.id}:number`, `#${p.number}`, "プルリクエスト全体を hunk で開く", t, (cx) => this.openPrInHunk(row, cx)))
          .when(row.current, (el) => el.child(div().flex_none().text_size(11).text_color(BRANCH_COLOR).child("[このブランチ]")))
          .child(div().flex_1().min_w(0).truncate().child(p.title))
          .when(p.isDraft, (el) => el.child(div().flex_none().px(4).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.blocked).child("下書き")))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(`${p.headRef} → ${p.baseRef}`))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(p.author || "作者不明"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(relativeTime(now, p.updatedAt)));
      }
      case "commit": {
        const c = row.commit;
        return rowBase(row.id, selected, t, 24)
          .on_click((_e, cx) => {
            this.selected = row.id;
            cx.notify();
          })
          .child(hunkLink(`${row.id}:hash`, c.short, "このコミットの差分を hunk で開く", t, (cx) => this.openCommitInHunk(row, cx)))
          .child(div().flex_1().min_w(0).truncate().child(c.subject))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(c.author))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(relativeTime(now, c.time)));
      }
      case "note":
        return div().min_h(ROW_HEIGHT).flex().items_center().pl(24).text_color(t.muted).child(row.text);
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
      .child(div().text_color(BRANCH_COLOR).child(target.label));
  }

  renderTitleBar(t: Theme) {
    return div()
      .flex()
      .flex_none()
      .items_center()
      .gap(8)
      .h(TITLE_BAR_HEIGHT)
      .px(14)
      .border_b(1)
      .border_color(t.border)
      .children(stackTabs("pull-requests", t))
      .child(div().flex_1())
      .child(countBadge(this.prs?.length ?? 0, t));
  }

  render() {
    const t = theme() as unknown as Theme;
    const rows = visibleRows(this.prs ?? [], this.target?.branch ?? null, this.expanded, this.commitsOf);
    const now = Math.floor(Date.now() / 1000);
    const placeholder = this.prs === null ? "プルリクエストを読み込み中…" : this.message;
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
              .id("pull-requests:list")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .when(rows.length === 0 && placeholder !== "", (el) => el.child(label(placeholder, t.muted)))
              .children(rows.map((r) => this.renderRow(r, t, now))),
          )
          .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1))),
      );
    return div()
      .id("pull-requests")
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
      .child(this.renderTitleBar(t))
      .child(body);
  }
}
