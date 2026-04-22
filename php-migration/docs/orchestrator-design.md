# Orchestrator 設計

`migration-orchestrator` のタスクキュー・依存解決・並列実行制御の仕様。

---

## タスクキュー構造

```yaml
# tasks.yaml  ← orchestrator が管理するランタイム状態ファイル
tasks:
  - task_id: string          # 例: phase-a-route-analyzer
    screen_id: string | null # Phase A/B はnull、C/D は対象画面ID
    phase: A | B | C | D
    agent: string            # 起動するエージェント名
    depends_on:              # 完了していなければ開始しない task_id リスト
      - string
    status: pending | running | done | failed | escalated
    retry_count: int         # デフォルト: 0
    input_path: string       # エージェントへの入力ファイルパス
    output_path: string      # エージェントの出力先ファイルパス
    started_at: ISO8601 | null
    finished_at: ISO8601 | null
    error: string | null     # 失敗時のエラーサマリ
```

---

## 依存解決アルゴリズム

トポロジカルソートで実行順序を決定する。

```
入力: tasks.yaml の depends_on グラフ
     + context-pack/{screen_id}.yaml の meta.dependencies（画面間依存）

1. 全タスクを有向グラフのノードとして登録
2. depends_on エッジを追加
3. Kahn's algorithm でソート
   - 循環依存を検出した場合は起動前にエラー終了
4. ソート結果をキューに積む
5. フェーズゲート条件（後述）に従いフェーズ間遷移を制御
```

---

## フェーズゲート条件

| ゲート | 条件 | 次アクション |
|--------|------|------------|
| A → B | Phase A の全タスクが `done` | Phase B タスクを `pending` → キュー投入 |
| B → C/D | Phase B の全タスクが `done` | Phase C/D タスクを `pending` → キュー投入（並列） |
| C → D（画面単位） | 対象画面の Phase C 全タスクが `done` | 同画面の Phase D タスクをキュー投入 |

---

## 並列実行制御

| フェーズ | 並列数上限 | 理由 |
|---------|-----------|------|
| A | 4 | 分析エージェント数（4種）に対応 |
| B | 1（順次） | mapping-rules → domain-model → context-packer の直列依存 |
| C | N（設定値） | 画面間に依存がなければ全並列可。デフォルト N=5 |
| D | N（設定値） | 同上。C と同じ N を使用 |

N は `orchestrator-config.yaml` で設定する。

```yaml
# orchestrator-config.yaml
parallel:
  phase_c_max: 5
  phase_d_max: 5
timeouts:
  phase_a_agent_sec: 300
  phase_b_agent_sec: 600
  phase_c_agent_sec: 900
  phase_d_agent_sec: 600
retry:
  max_count: 2              # REVIEW_REQUIRED の最大差し戻し回数
```

---

## ステータス遷移

```
pending
  │
  ▼ 依存タスクが全 done かつ並列数に空きあり
running
  ├─ 成功 ──────────────────────────────────── done
  │
  └─ 失敗
       │
       ├─ retry_count < max_count ──────────── pending（retry_count++）
       │
       └─ retry_count >= max_count ─────────── failed
                                                 │
                                                 ▼ orchestrator が判定
                                              escalated（人手キューへ）
```

---

## エージェント起動インタフェース

orchestrator が各エージェントを起動する際の標準インタフェース。

```yaml
# エージェント起動パラメータ（共通）
agent_invocation:
  agent: string              # エージェント名
  input:
    context_pack: string     # context-pack/{screen_id}.yaml のパス（Phase C/D）
    inventory_dir: string    # Phase A: 分析対象ソースツリーのルート
    rules_dir: string        # Phase B: mapping-rules/ のパス
  output:
    artifact_path: string    # 生成成果物の出力先
    flag_path: string        # フラグ出力先 例: flags/{task_id}.yaml
  timeout_sec: int           # orchestrator-config.yaml の値を使用
```

### フラグ出力先の命名規則

```
flags/
├── {task_id}-NEEDS_RULE.yaml
├── {task_id}-REVIEW_REQUIRED.yaml
└── {task_id}-ESCALATE.yaml
```

orchestrator は `flags/` を定期ポーリングし、フラグを検出したら `failure-handling.md` の振る舞いフローを実行する。

---

## 起動シーケンス（擬似コード）

```
load orchestrator-config.yaml
load all context-pack/*.yaml → extract meta.dependencies
build task graph from depends_on + meta.dependencies
topological_sort → initial_queue

while queue is not empty or any task is running:
    check flags/ for new flag files → handle each flag
    for each task in queue where depends_on all done:
        if running_count < parallel_limit[task.phase]:
            start agent(task)
            task.status = running
    wait for any running agent to finish
    update task.status = done | failed
    apply status transition rules
    check phase gates → enqueue next phase tasks if gate passes

output final_report.yaml
```

---

## 最終レポート形式

```yaml
# final_report.yaml
summary:
  total_screens: int
  done: int
  escalated: int
  skipped: int
  started_at: ISO8601
  finished_at: ISO8601

screens:
  - screen_id: string
    status: done | escalated | skipped
    phases:
      A: done | skipped
      B: done | skipped
      C: done | failed
      D: done | failed
    flags: []              # 発生したフラグの一覧
    escalation_reason: string | null
```
