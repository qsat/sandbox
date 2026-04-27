---
name: adapt-aidev
description: 既存JavaプロジェクトをAIドリブン開発に適応させるスキル。仕様抽出→ドメインモデリング→開発案件実行のフルパイプライン。adapt-aidev/CLAUDE.md を参照して実行する。
---

# /adapt-aidev フルパイプライン実行

## 使い方

```
/adapt-aidev <project_root>
```

例: `/adapt-aidev study-sa/sample`

## 実行手順

`adapt-aidev/CLAUDE.md` と `adapt-aidev/SKILL.md` を読み込み、以下を実行する。

### Phase A: 仕様抽出

`adapt-aidev/agents/spec-extractor.md` のプロンプトに従い、`<project_root>` を解析する。

- 入力: `<project_root>`
- 出力: `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml`

### Phase B: ドメインモデリング

Phase A 完了後、`adapt-aidev/agents/domain-modeler.md` のプロンプトに従いドメインモデルを生成する。

- 入力: `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml`
- 出力: `adapt-aidev/artifacts/phase-b/domain-model/index.yaml`

### Phase C: 開発タスク実行

Phase B 完了後、ユーザーに実行するタスクを確認する。

タスク指定がある場合は `adapt-aidev/agents/task-executor.md` に従って実装する。

## 注意事項

- 各フェーズ完了後にユーザーに進捗を報告する
- Phase A/B の成果物は git にコミットする
- Phase C の実装は既存コードのパターンを踏襲する
