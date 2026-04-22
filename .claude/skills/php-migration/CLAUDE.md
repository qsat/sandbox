# PHP移植フレームワーク

ZF1（Zend Framework 1）アプリケーションをSpring Bootに移植するためのAIエージェントフレームワーク。

## スキル（スラッシュコマンド）

| コマンド | 用途 |
|---------|------|
| `/php-migrate <source_root>` | フルパイプライン実行（Phase A→B→C→D） |
| `/php-migrate-analyze <source_root>` | Phase A 分析のみ（現状把握・工数見積もり） |
| `/php-migrate-screen <screen_id>` | 単一画面の移植・検証（Phase C/D） |

## ディレクトリ構造

```
php-migration/
├── CLAUDE.md                    ← このファイル
├── config/
│   └── orchestrator-config.yaml ← 並列数・タイムアウト設定
├── mapping-rules/               ← 変換辞書（Phase B で自動生成）
│   ├── controller.yaml
│   ├── template.yaml
│   ├── helper.yaml
│   ├── api-client.yaml
│   └── idiom.yaml
├── docs/
│   ├── deliverables.md          ← 成果物リスト
│   ├── agent-design.md          ← エージェント構成・責務
│   ├── context-pack-schema.md   ← コンテキストパックYAMLスキーマ
│   ├── mapping-rules-schema.md  ← 変換辞書YAMLスキーマ
│   ├── orchestrator-design.md   ← タスクキュー・依存解決設計
│   ├── failure-handling.md      ← フラグ仕様・エスカレーションフロー
│   └── prompt-templates/        ← 全16エージェントのプロンプト
│       ├── orchestrator.md
│       ├── phase-a-*.md         （4ファイル）
│       ├── phase-b-*.md         （3ファイル）
│       ├── phase-c-*.md         （4ファイル）
│       └── phase-d-*.md         （4ファイル）
├── artifacts/                   ← Phase A/B 成果物（実行時生成）
├── context-pack/                ← 画面単位コンテキストパック（実行時生成）
├── flags/                       ← エージェント間フラグ（実行時生成）
│   └── processed/               ← 処理済みフラグアーカイブ
├── dod-results/                 ← DoD・コードレビュー結果（実行時生成）
├── snapshots/                   ← ゴールデンHTMLスナップショット（git管理）
└── human-queue/                 ← エスカレーション引き渡しキュー（実行時生成）
```

## 推奨実行順序

### 初回

```
/php-migrate-analyze /path/to/zf1-app
# → artifacts/ にインベントリが生成される。内容を確認する

/php-migrate /path/to/zf1-app
# → Phase B でマッピングルール・ドメインモデル・コンテキストパックが生成される
# → Phase C/D で画面ごとの移植・検証が並列実行される
```

### 単一画面のデバッグ・再実行

```
/php-migrate-screen property-detail
# → context-pack/property-detail.yaml をもとに移植・検証を実行する
```

## エージェントフェーズ

```
Phase A（分析）: route-analyzer / template-analyzer / api-catalog-builder / session-scanner
    ↓ フェーズゲート（全完了）
Phase B（設計）: mapping-rule-author → domain-modeler → context-packer
    ↓ フェーズゲート（全完了）
Phase C（移植）: controller-migrator / template-migrator / service-builder / api-client-builder
    ↓ 画面単位で完了次第
Phase D（検証）: dod-checker / snapshot-comparator / code-reviewer / test-generator
```

## フラグ仕様（エージェント間ハンドオフ）

| フラグ | 意味 | 振る舞い |
|--------|------|---------|
| `UNRESOLVABLE` | 静的解析不能 | 記録して継続 |
| `NEEDS_RULE` | 変換ルール未定義 | mapping-rule-author が追記→再実行 |
| `REVIEW_REQUIRED` | DoDチェック失敗 | 移植エージェントに差し戻し（最大2回） |
| `ESCALATE` | リトライ上限超過 | human-queue に出力してスキップ |

詳細: `docs/failure-handling.md`

## 設定変更

`config/orchestrator-config.yaml` で並列数・タイムアウト・リトライ上限を変更できます。
