# 失敗フラグ仕様

エージェント間ハンドオフ契約。`agent-design.md` の失敗時振る舞い規約の詳細実装定義。
タスクステータスとの紐付けは `orchestrator-design.md` を参照。

---

## フラグ一覧

| フラグ | 発火主体 | 受信主体 | 意味 |
|--------|---------|---------|------|
| `UNRESOLVABLE` | route-analyzer / template-analyzer / api-catalog-builder / session-scanner | orchestrator | 静的解析で解読不能なコードを検出。当該箇所をスキップして継続 |
| `NEEDS_RULE` | context-packer | mapping-rule-author + orchestrator | 変換ルール辞書に未定義パターンを検出。ルール追記まで当該画面の移植を停止 |
| `REVIEW_REQUIRED` | dod-checker | orchestrator → 移植エージェント（差し戻し） | DoDチェック失敗。移植エージェントへ差し戻して再生成を要求 |
| `ESCALATE` | orchestrator | 人手エスカレーションキュー | リトライ上限到達 or 手動介入が必要。当該画面をスキップして継続 |

---

## フラグ共通 YAML 書式

```yaml
flag: UNRESOLVABLE | NEEDS_RULE | REVIEW_REQUIRED | ESCALATE
agent: string          # 発火エージェント名
screen_id: string | null  # 画面に紐づかない場合は null（Phase A/B）
task_id: string        # orchestrator-design.md の task_id と対応
location: string       # ファイルパス:行番号 例: controllers/PropertyController.php:42
detail: object         # フラグ種別ごとの詳細（後述）
timestamp: ISO8601
```

出力先: `flags/{task_id}-{FLAG}.yaml`（orchestrator-design.md 参照）

---

## フラグ別 詳細フィールドと振る舞い

### UNRESOLVABLE

**発火条件:** 分析エージェントがPHPマクロ展開、動的include、eval等で静的解析不能な箇所を検出したとき。

```yaml
detail:
  file: string           # 問題のあるファイルパス
  reason: string         # 例: "dynamic include via variable: require $path"
  severity: warning | error
  partial_result: boolean  # 部分的な解析結果を出力できたか
```

**振る舞いフロー:**

```
UNRESOLVABLE 検出
  │
  ├─ severity: warning → インベントリに UNRESOLVABLE マーク付きで記録 → 継続
  │
  └─ severity: error   → 当該ファイルをインベントリから除外 → 継続
                          （final_report.yaml の escalated に計上）
```

---

### NEEDS_RULE

**発火条件:** context-packer が source ファイルをスキャンし、`mapping-rules/*.yaml` に一致するルールが存在しないパターンを検出したとき。（`mapping-rules-schema.md` の抜粋ロジック参照）

```yaml
detail:
  detected_pattern: string   # 未定義パターンの該当コード断片
  category: string           # 推定カテゴリ（controller/template/helper/api-client/idiom）
  file: string
  line: int
  suggestion: string | null  # 変換先の候補（任意・mapping-rule-author への参考情報）
```

**振る舞いフロー:**

```
NEEDS_RULE 検出
  │
  ▼
当該画面のPhase C/Dタスクを pending のまま保留
  │
  ▼
mapping-rule-author に NEEDS_RULE フラグを通知
  │
  ▼
mapping-rule-author がルールを mapping-rules/*.yaml へ追記
  │
  ▼
orchestrator が追記を検出 → context-packer を再実行
  │
  ▼
コンテキストパック再生成完了 → Phase C/D を pending → running に遷移
```

**タイムアウト:** ルール追記待ちが `orchestrator-config.yaml` の `needs_rule_timeout_sec`（デフォルト: 3600）を超えた場合は ESCALATE に昇格。

---

### REVIEW_REQUIRED

**発火条件:** dod-checker が `dod.*` の評価で1件以上の FAIL を検出したとき。

```yaml
detail:
  failed_items:
    - item_id: string        # dod.display_items[].id 等
      type: display_item | transition | api_call | snapshot | test_scenario
      expected: string
      actual: string         # 実際に観測された値
      diff: string | null    # スナップショット比較の場合の差分情報
  retry_count: int           # 現在の差し戻し回数（0始まり）
```

**振る舞いフロー:**

```
REVIEW_REQUIRED 検出
  │
  ├─ retry_count < max_count（orchestrator-config.yaml: retry.max_count）
  │    │
  │    ▼
  │  失敗詳細を付けて移植エージェント（controller-migrator/template-migrator 等）へ差し戻し
  │  task.status = pending, task.retry_count++
  │
  └─ retry_count >= max_count
       │
       ▼
     ESCALATE フラグを発火
```

**差し戻し時に移植エージェントへ渡す追加情報:**

```yaml
resubmit_context:
  original_context_pack_path: string
  review_failed_items:         # REVIEW_REQUIRED.detail.failed_items をそのまま渡す
    - ...
  instruction: string          # 例: "以下の失敗項目を修正して再生成してください"
```

---

### ESCALATE

**発火条件:**
- REVIEW_REQUIRED の retry_count が max_count に到達
- NEEDS_RULE のタイムアウト
- orchestrator が予期しない内部エラーを検出

```yaml
detail:
  reason: max_retry_exceeded | needs_rule_timeout | internal_error
  original_flag: REVIEW_REQUIRED | NEEDS_RULE | null
  history:                   # これまでの試行履歴
    - attempt: int
      agent: string
      timestamp: ISO8601
      error_summary: string
```

**振る舞いフロー:**

```
ESCALATE 検出
  │
  ▼
当該画面のタスクを status: escalated に変更
  │
  ▼
エスカレーションレポートを human-queue/{screen_id}-escalation.yaml に出力
  │
  ▼
当該画面をスキップして次の画面の処理を継続
  │
  ▼
final_report.yaml の escalated にカウント
```

---

## エスカレーションレポート形式（人手への引き渡し物）

```yaml
# human-queue/{screen_id}-escalation.yaml
screen_id: string
screen_name: string
escalated_at: ISO8601
reason: string                # ESCALATE.detail.reason の人が読める説明

context_pack_path: string     # 移植に使ったコンテキストパックのパス
source_files:                 # 人手確認が必要なソースファイル
  - string

failed_dod_items:             # DoDで失敗した項目（REVIEW_REQUIRED由来の場合）
  - item_id: string
    expected: string
    actual: string

undefined_patterns:           # 未定義変換パターン（NEEDS_RULE由来の場合）
  - detected_pattern: string
    file: string
    line: int

suggested_actions:            # orchestrator が推定する対処案
  - string

partial_artifacts:            # 途中まで生成された成果物（あれば）
  - path: string
    status: partial | corrupted
```

---

## リトライ・タイムアウト設定値

`orchestrator-config.yaml` で一元管理する（`orchestrator-design.md` 参照）。

| 設定キー | デフォルト値 | 意味 |
|---------|------------|------|
| `retry.max_count` | 2 | REVIEW_REQUIRED の最大差し戻し回数 |
| `needs_rule_timeout_sec` | 3600 | NEEDS_RULE → ESCALATE 昇格までの待機時間 |
| `timeouts.phase_c_agent_sec` | 900 | 移植エージェント1回あたりのタイムアウト |
| `timeouts.phase_d_agent_sec` | 600 | 検証エージェント1回あたりのタイムアウト |
