# PHP移植 フルパイプライン実行

ZF1アプリケーションをSpring Bootに移植する全フェーズ（A→B→C→D）を実行します。

## 引数

`$ARGUMENTS` の形式: `<source_root>`

例: `/path/to/zf1-app`

## 実行手順

### 1. 設定・ドキュメントの読み込み

以下のファイルを読み込んでください。

- `.claude/skills/php-migration/config/orchestrator-config.yaml` — 並列数・タイムアウト設定
- `.claude/skills/php-migration/agents/orchestrator.md` — Orchestrator の動作仕様
- `.claude/skills/php-migration/docs/agent-design.md` — エージェント構成とフェーズ定義
- `.claude/skills/php-migration/schemas/failure-handling.md` — フラグ処理の振る舞い

### 2. source_root の確認

`$ARGUMENTS` を `source_root` として使用します。
ディレクトリが存在するか確認し、存在しない場合はユーザーに報告して終了してください。

### 3. tasks.yaml の初期化または再開

`.claude/skills/php-migration/tasks.yaml` が存在する場合:
- 読み込んで `status: done` タスクを確認し、ユーザーに現状を報告してから再開します。

存在しない場合:
- `orchestrator.md` の「Step 0: 初期化」に従い `tasks.yaml` を生成します。

### 4. オーケストレーション実行

`orchestrator.md` の「起動シーケンス Step 1〜」に従いメインループを実行します。

各エージェントを起動する際は、対応するプロンプトテンプレートを読み込んでください。

| フェーズ | テンプレートパス |
|---------|--------------|
| route-analyzer | `.claude/skills/php-migration/agents/route-analyzer.md` |
| template-analyzer | `.claude/skills/php-migration/agents/template-analyzer.md` |
| api-catalog-builder | `.claude/skills/php-migration/agents/api-catalog-builder.md` |
| session-scanner | `.claude/skills/php-migration/agents/session-scanner.md` |
| mapping-rule-author | `.claude/skills/php-migration/agents/mapping-rule-author.md` |
| domain-modeler | `.claude/skills/php-migration/agents/domain-modeler.md` |
| context-packer | `.claude/skills/php-migration/agents/context-packer.md` |
| controller-migrator | `.claude/skills/php-migration/agents/controller-migrator.md` |
| template-migrator | `.claude/skills/php-migration/agents/template-migrator.md` |
| service-builder | `.claude/skills/php-migration/agents/service-builder.md` |
| api-client-builder | `.claude/skills/php-migration/agents/api-client-builder.md` |
| dod-checker | `.claude/skills/php-migration/agents/dod-checker.md` |
| snapshot-comparator | `.claude/skills/php-migration/agents/snapshot-comparator.md` |
| code-reviewer | `.claude/skills/php-migration/agents/code-reviewer.md` |
| test-generator | `.claude/skills/php-migration/agents/test-generator.md` |

### 5. 完了報告

`.claude/skills/php-migration/final_report.yaml` の内容をもとに結果をユーザーに報告してください。

- 移植完了画面数
- エスカレーション画面とその理由
- 未解決ルール（NEEDS_RULE → TODO のまま残ったもの）
- 次のアクション候補
