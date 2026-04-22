# PHP移植 Phase A 分析のみ実行

ZF1アプリケーションの静的解析（Phase A）のみを実行し、インベントリを生成します。
移植を始める前の現状把握・工数見積もりに使います。

## 引数

`$ARGUMENTS` の形式: `<source_root>`

例: `/path/to/zf1-app`

## 実行手順

### 1. source_root の確認

`$ARGUMENTS` を `source_root` として使用します。
ディレクトリが存在するか確認し、存在しない場合は報告して終了してください。

### 2. 4つの分析エージェントを順次実行

以下のテンプレートを読み込み、各エージェントの指示に従って分析を実行してください。

#### route-analyzer

`.claude/skills/php-migration/agents/route-analyzer.md` を読み込み、
`source_root` を解析して `.claude/skills/php-migration/artifacts/routing-inventory.yaml` を生成します。

#### template-analyzer

`.claude/skills/php-migration/agents/template-analyzer.md` を読み込み、
`.claude/skills/php-migration/artifacts/template-inventory.yaml` を生成します。

#### api-catalog-builder

`.claude/skills/php-migration/agents/api-catalog-builder.md` を読み込み、
`.claude/skills/php-migration/artifacts/api-catalog.yaml` を生成します。

#### session-scanner

`.claude/skills/php-migration/agents/session-scanner.md` を読み込み、
`.claude/skills/php-migration/artifacts/session-inventory.yaml` を生成します。

### 3. サマリの報告

4ファイルが生成されたら、以下をユーザーに報告してください。

- 検出された画面数（ルート数）
- テンプレートファイル総数・layout/main/partial の内訳
- 外部API呼び出し数とエンドポイント一覧
- セッション利用箇所数
- UNRESOLVABLE フラグが出た箇所とその理由
- 次のステップ（`/php-migrate` でフルパイプライン実行 or 個別対応）
