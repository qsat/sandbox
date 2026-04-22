# PHP移植 エージェント設計

## 終端条件

AI agentが「人手レビューなしで移植 → 動作同等性が機械的に検証可能」な状態。

---

## エージェント構成

```
migration-orchestrator
├── Phase A: 分析（1回・部分並列）
│   ├── route-analyzer
│   ├── template-analyzer
│   ├── api-catalog-builder
│   └── session-scanner
├── Phase B: 設計（1回・順次）
│   ├── mapping-rule-author
│   ├── domain-modeler
│   └── context-packer          ← 画面ごとのコンテキストパックを生成
└── Phase C/D: 移植・検証（画面単位・並列）
    ├── controller-migrator
    ├── template-migrator
    ├── service-builder
    ├── api-client-builder
    ├── dod-checker
    ├── snapshot-comparator
    ├── code-reviewer
    └── test-generator
```

---

## エージェント責務定義

### migration-orchestrator

- タスクキューを管理し、依存順序に従って各エージェントを起動する
- 入力: deliverables.md、フェーズA/B成果物
- 出力: 移植済み画面ごとのステータスレポート
- 失敗時: エラー詳細をログに記録し、当該画面をスキップして継続

### Phase A: 分析系

| エージェント | 入力 | 出力 |
|------------|------|------|
| route-analyzer | ZF1ソースツリー（routes.ini, Bootstrap.php） | `routing-inventory.yaml` |
| template-analyzer | views/ 以下のすべての.phtml/.tpl | `template-inventory.yaml` |
| api-catalog-builder | PHP HTTPクライアント呼び出し箇所 | `api-catalog.yaml` |
| session-scanner | Zend_Session_Namespace利用箇所 | `session-inventory.yaml` |

### Phase B: 設計系

| エージェント | 入力 | 出力 |
|------------|------|------|
| mapping-rule-author | フェーズA成果物すべて | `mapping-rules.yaml` |
| domain-modeler | api-catalog.yaml | `domain-model.yaml` |
| context-packer | 上記すべて + DoD定義 | `context-pack/{screen_id}.yaml` （画面数分） |

### Phase C: 移植系（画面単位）

各エージェントは `context-pack/{screen_id}.yaml` のみを入力とする。

| エージェント | 参照フィールド | 出力 |
|------------|-------------|------|
| controller-migrator | routing, source.controller, api_calls, mapping_rules.controller | `@Controller` クラス |
| template-migrator | source.templates, mapping_rules.template | Thymeleafテンプレート |
| service-builder | source.controller, domain_objects, api_calls | `@Service` クラス |
| api-client-builder | api_calls, mapping_rules.api_client | WebClient実装 |

### Phase D: 検証系（画面単位）

| エージェント | 参照フィールド | 合否判定基準 |
|------------|-------------|------------|
| dod-checker | dod.* | dod内の全項目がPASS |
| snapshot-comparator | dod.snapshot_baseline | 差分ピクセル率 < 閾値 |
| code-reviewer | target.* | checkstyle/spotbugsエラー0 |
| test-generator | dod.test_scenarios, api_calls | カバレッジ基準を満たすテスト生成 |

---

## 失敗時の振る舞い規約

| 状況 | 振る舞い |
|------|---------|
| 分析エージェントが解析不能なコードを検出 | `UNRESOLVABLE` フラグを付けてインベントリに記録、継続 |
| 移植エージェントが変換ルールに未定義パターンを検出 | `NEEDS_RULE` フラグで停止、mapping-rules.yamlへの追記を要求 |
| DoDチェックが失敗 | `REVIEW_REQUIRED` フラグ付きで移植エージェントに差し戻し（最大2回） |
| 2回差し戻し後も失敗 | `ESCALATE` フラグを付けて人手エスカレーションキューへ |
