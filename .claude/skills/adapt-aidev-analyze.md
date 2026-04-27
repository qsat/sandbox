---
name: adapt-aidev-analyze
description: Phase A のみ実行：既存JavaプロジェクトのコードベースとドキュメントからAI開発用の仕様インベントリを生成する。現状把握・工数見積もりに使用。
---

# /adapt-aidev-analyze 仕様抽出（Phase A のみ）

## 使い方

```
/adapt-aidev-analyze <project_root>
```

例: `/adapt-aidev-analyze study-sa/sample`

## 実行手順

`adapt-aidev/agents/spec-extractor.md` のプロンプトに従い、以下を実行する。

1. `<project_root>` 以下のJavaソースファイル・ドキュメント・スキーマを解析
2. tech_stack・screens・entities・business_rules・use_cases・todo_items・existing_docs を抽出
3. 結果を `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml` に出力
4. 未実装タスク（TODO(human)マーカー）の一覧をユーザーに報告

## 出力

- `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml`

## 次のステップ

仕様抽出後は `/adapt-aidev-model` でドメインモデリングを実行できる。
