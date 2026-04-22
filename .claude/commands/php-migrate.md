# PHP移植 フルパイプライン実行

ZF1アプリケーションをSpring Bootに移植する全フェーズ（A→B→C→D）を実行します。

## 引数

`$ARGUMENTS` の形式: `<source_root>`

例: `/path/to/zf1-app`

## 実行手順

### 1. 設定・ドキュメントの読み込み

以下のファイルを読み込んでください。

- `php-migration/config/orchestrator-config.yaml` — 並列数・タイムアウト設定
- `php-migration/docs/prompt-templates/orchestrator.md` — Orchestrator の動作仕様
- `php-migration/docs/agent-design.md` — エージェント構成とフェーズ定義
- `php-migration/docs/failure-handling.md` — フラグ処理の振る舞い

### 2. source_root の確認

`$ARGUMENTS` を `source_root` として使用します。
ディレクトリが存在するか確認し、存在しない場合はユーザーに報告して終了してください。

### 3. tasks.yaml の初期化または再開

`php-migration/tasks.yaml` が存在する場合:
- 読み込んで `status: done` タスクを確認し、ユーザーに現状を報告してから再開します。

存在しない場合:
- `orchestrator.md` の「Step 0: 初期化」に従い `tasks.yaml` を生成します。

### 4. オーケストレーション実行

`orchestrator.md` の「起動シーケンス Step 1〜」に従いメインループを実行します。

各エージェントを起動する際は、対応するプロンプトテンプレートを読み込んでください。

| フェーズ | テンプレートパス |
|---------|--------------|
| route-analyzer | `php-migration/docs/prompt-templates/phase-a-route-analyzer.md` |
| template-analyzer | `php-migration/docs/prompt-templates/phase-a-template-analyzer.md` |
| api-catalog-builder | `php-migration/docs/prompt-templates/phase-a-api-catalog-builder.md` |
| session-scanner | `php-migration/docs/prompt-templates/phase-a-session-scanner.md` |
| mapping-rule-author | `php-migration/docs/prompt-templates/phase-b-mapping-rule-author.md` |
| domain-modeler | `php-migration/docs/prompt-templates/phase-b-domain-modeler.md` |
| context-packer | `php-migration/docs/prompt-templates/phase-b-context-packer.md` |
| controller-migrator | `php-migration/docs/prompt-templates/phase-c-controller-migrator.md` |
| template-migrator | `php-migration/docs/prompt-templates/phase-c-template-migrator.md` |
| service-builder | `php-migration/docs/prompt-templates/phase-c-service-builder.md` |
| api-client-builder | `php-migration/docs/prompt-templates/phase-c-api-client-builder.md` |
| dod-checker | `php-migration/docs/prompt-templates/phase-d-dod-checker.md` |
| snapshot-comparator | `php-migration/docs/prompt-templates/phase-d-snapshot-comparator.md` |
| code-reviewer | `php-migration/docs/prompt-templates/phase-d-code-reviewer.md` |
| test-generator | `php-migration/docs/prompt-templates/phase-d-test-generator.md` |

### 5. 完了報告

`php-migration/final_report.yaml` の内容をもとに結果をユーザーに報告してください。

- 移植完了画面数
- エスカレーション画面とその理由
- 未解決ルール（NEEDS_RULE → TODO のまま残ったもの）
- 次のアクション候補
