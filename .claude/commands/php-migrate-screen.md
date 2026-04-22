# PHP移植 単一画面の移植・検証

指定した画面のPhase C（移植）とPhase D（検証）のみを実行します。
Phase A/B が完了してコンテキストパックが生成済みであることが前提です。

## 引数

`$ARGUMENTS` の形式: `<screen_id>`

例: `property-detail`

## 実行手順

### 1. コンテキストパックの確認

`php-migration/context-pack/$ARGUMENTS.yaml` が存在するか確認します。

存在しない場合:
- Phase B が未完了の可能性があります
- ユーザーに `/php-migrate-analyze` → `/php-migrate` の順で実行するよう案内して終了してください

存在する場合:
- ファイルを読み込み、`meta.screen_name` と `meta.dependencies` をユーザーに報告してください
- `meta.dependencies` のコンテキストパックがすべて存在するか確認してください

### 2. Phase C: 移植エージェントの実行

コンテキストパックの内容をもとに、以下を並列で実行します（依存関係なし）。

#### controller-migrator

`php-migration/agents/controller-migrator.md` を読み込み実行します。

#### template-migrator

`php-migration/agents/template-migrator.md` を読み込み実行します。

#### service-builder

`php-migration/agents/service-builder.md` を読み込み実行します。

#### api-client-builder

`php-migration/agents/api-client-builder.md` を読み込み実行します。

いずれかが `NEEDS_RULE` フラグを出力した場合:
- `php-migration/schemas/failure-handling.md` の NEEDS_RULE 振る舞いフローに従って処理します
- `php-migration/agents/mapping-rule-author.md` を appendモードで実行し、ルールを追記します
- ルール追記後、該当エージェントを再実行します

### 3. Phase D: 検証エージェントの実行

Phase C の全エージェントが完了したら、以下を並列で実行します。

#### dod-checker

`php-migration/agents/dod-checker.md` を読み込み実行します。
結果を `php-migration/dod-results/$ARGUMENTS.yaml` に出力します。

#### snapshot-comparator

`php-migration/agents/snapshot-comparator.md` を読み込み実行します。
結果を `php-migration/dod-results/$ARGUMENTS-snapshot.yaml` に出力します。

#### code-reviewer

`php-migration/agents/code-reviewer.md` を読み込み実行します。
結果を `php-migration/dod-results/$ARGUMENTS-codereview.yaml` に出力します。

#### test-generator

`php-migration/agents/test-generator.md` を読み込み実行します。

### 4. 結果の統合と報告

`dod-checker` の `overall` が `FAIL` の場合:
- `php-migration/schemas/failure-handling.md` の REVIEW_REQUIRED フローに従います
- Phase C エージェントに差し戻して再実行します（最大2回）
- 2回失敗した場合は `php-migration/human-queue/$ARGUMENTS-escalation.yaml` を生成して報告します

`overall: PASS` の場合、以下をユーザーに報告してください。

- 生成されたファイル一覧
- DoDチェック結果サマリ
- コードレビュー結果（FAIL/WARN/INFO の件数）
- テスト生成数
- 残作業（TODO コメント箇所、E2Eスタブの有効化等）
