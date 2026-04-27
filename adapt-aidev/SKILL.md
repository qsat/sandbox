---
name: adapt-aidev
description: 既存JavaプロジェクトをAIドリブン開発に適応させるスキル。仕様抽出→ドメインモデリング→開発案件実行のフルパイプラインを自律的に実行します。人手レビューなしで開発タスクを機械的に実行できることを終端条件とします。
---

# Adapt AI-Dev Skill

## 使いどころ

- 既存JavaプロジェクトのコードベースとドキュメントからAI開発用の仕様・ドメインモデルを抽出する
- ドメインモデルをベースに開発案件（機能追加・バグ修正・リファクタリング）をAIに実行させる
- Spring Boot・SAStruts・その他Javaフレームワークに対応

## スラッシュコマンド

| コマンド | 用途 |
|---------|------|
| `/adapt-aidev <project_root>` | フルパイプライン実行（Phase A→B→C） |
| `/adapt-aidev-analyze <project_root>` | Phase A のみ：仕様抽出・インベントリ生成 |
| `/adapt-aidev-model` | Phase B のみ：ドメインモデリング（Phase A成果物が必要） |
| `/adapt-aidev-task <task>` | Phase C のみ：指定タスクの実行（Phase B成果物が必要） |

## パイプライン概要

```
[コードベース + 仕様書]
         ↓ Phase A: 仕様抽出
  artifacts/phase-a/spec-inventory/index.yaml
         ↓ Phase B: ドメインモデリング
  artifacts/phase-b/domain-model/index.yaml
         ↓ Phase C: 開発案件実行
  [実装コード（プロジェクト内に直接出力）]
```

## エージェント構成

| フェーズ | エージェント | ファイル | 入力 | 出力 |
|---------|------------|---------|------|------|
| Phase A | spec-extractor | agents/spec-extractor.md | project_root | artifacts/phase-a/spec-inventory/index.yaml |
| Phase B | domain-modeler | agents/domain-modeler.md | spec-inventory.yaml | artifacts/phase-b/domain-model/index.yaml |
| Phase C | task-executor | agents/task-executor.md | domain-model.yaml + task | コード変更 |
