---
name: php-migration
description: ZF1（Zend Framework 1）PHPアプリケーションをSpring Boot + Thymeleafに移植するスキル。静的解析→変換ルール生成→コード移植→DoD検証のフルパイプラインを自律的に実行します。人手レビューなしで動作同等性を機械的に検証することが終端条件です。
---

# PHP Migration Skill

## 使いどころ

- ZF1アプリケーションをSpring Bootに移植する
- 移植前の現状把握・工数見積もりを行う
- 特定画面の移植・検証をやり直す

## 実行モード

### フルパイプライン（mode: full）

Phase A（分析）→ Phase B（設計）→ Phase C（移植）→ Phase D（検証）を順次実行します。

```
source_root: <ZF1アプリケーションのルートパス>
mode: full
```

### 分析のみ（mode: analyze）

Phase A のみ実行してインベントリを生成します。工数見積もりや現状把握に使います。

```
source_root: <ZF1アプリケーションのルートパス>
mode: analyze
```

### 単一画面（mode: screen）

Phase B 完了後、指定画面の Phase C/D のみ実行します。

```
screen_id: <画面ID 例: property-detail>
mode: screen
```

## エージェント構成

各エージェントの詳細プロンプトは `agents/` ディレクトリにあります。

### Phase A：分析（並列実行）

| エージェント | ファイル | 出力 |
|------------|---------|------|
| route-analyzer | agents/route-analyzer.md | artifacts/routing-inventory.yaml |
| template-analyzer | agents/template-analyzer.md | artifacts/template-inventory.yaml |
| api-catalog-builder | agents/api-catalog-builder.md | artifacts/api-catalog.yaml |
| session-scanner | agents/session-scanner.md | artifacts/session-inventory.yaml |

### Phase B：設計（順次実行）

| エージェント | ファイル | 出力 |
|------------|---------|------|
| mapping-rule-author | agents/mapping-rule-author.md | mapping-rules/*.yaml |
| domain-modeler | agents/domain-modeler.md | artifacts/domain-model.yaml |
| context-packer | agents/context-packer.md | context-pack/{screen_id}.yaml |

### Phase C：移植（画面単位・並列実行）

| エージェント | ファイル | 出力先 |
|------------|---------|--------|
| controller-migrator | agents/controller-migrator.md | {{output_dir}}/src/main/java/ |
| template-migrator | agents/template-migrator.md | {{output_dir}}/src/main/resources/ |
| service-builder | agents/service-builder.md | {{output_dir}}/src/main/java/ |
| api-client-builder | agents/api-client-builder.md | {{output_dir}}/src/main/java/ |

### Phase D：検証（画面単位・並列実行）

| エージェント | ファイル | 出力先 |
|------------|---------|--------|
| dod-checker | agents/dod-checker.md | dod-results/{screen_id}.yaml |
| snapshot-comparator | agents/snapshot-comparator.md | dod-results/{screen_id}-snapshot.yaml |
| code-reviewer | agents/code-reviewer.md | dod-results/{screen_id}-codereview.yaml |
| test-generator | agents/test-generator.md | {{output_dir}}/src/test/java/ |

## フラグ仕様（エージェント間ハンドオフ）

| フラグ | 発火主体 | 振る舞い |
|--------|---------|---------|
| UNRESOLVABLE | Phase A | 記録して継続 |
| NEEDS_RULE | context-packer・移植エージェント | mapping-rule-author が追記→再実行 |
| REVIEW_REQUIRED | dod-checker | 移植エージェントへ差し戻し（最大2回） |
| ESCALATE | orchestrator | human-queue/ に出力してスキップ |

詳細: schemas/failure-handling.md

## 参照スキーマ

| ファイル | 内容 |
|---------|------|
| schemas/context-pack.md | コンテキストパック YAML スキーマ |
| schemas/mapping-rules.md | 変換辞書 YAML スキーマ |
| schemas/failure-handling.md | フラグ仕様・エスカレーションフロー |
| schemas/orchestrator-design.md | タスクキュー・依存解決設計 |

## ディレクトリ構造

スキル定義（`.claude/skills/php-migration/`）とランタイム出力はプロジェクトルートで分離します。

```
{プロジェクトルート}/
├── .claude/skills/php-migration/  ← スキル定義（このディレクトリ）
│   ├── SKILL.md
│   ├── agents/
│   ├── schemas/
│   └── config/orchestrator-config.yaml
│
├── {zf1-source}/          ← 移植元 PHP（source_root に指定）
├── spring-boot-app/       ← 移植先 Spring Boot（output_dir）
│
├── mapping-rules/         ← 変換辞書（Phase B で生成・git管理推奨）
├── snapshots/             ← ゴールデン HTML（git管理推奨）
│
├── artifacts/             ← Phase A/B 成果物（gitignore推奨）
├── context-pack/          ← コンテキストパック（gitignore推奨）
├── flags/                 ← エージェント間フラグ（gitignore推奨）
├── dod-results/           ← 検証結果（gitignore推奨）
├── human-queue/           ← エスカレーション（gitignore推奨）
├── tasks.yaml             ← Orchestrator 状態（gitignore推奨）
└── final_report.yaml      ← 移植レポート（gitignore推奨）
```

## 開始手順

1. `config/orchestrator-config.yaml` を読み込む
2. `agents/orchestrator.md` の指示に従いパイプラインを制御する
3. 各フェーズで対応する `agents/*.md` を読み込んでエージェントを実行する
4. フラグ処理は `schemas/failure-handling.md` を参照する
