---
name: adapt-aidev-model
description: Phase B のみ実行：spec-inventory.yaml を入力としてDDDドメインモデルを生成する。Phase A の実行が前提。
---

# /adapt-aidev-model ドメインモデリング（Phase B のみ）

## 使い方

```
/adapt-aidev-model
```

## 前提条件

`adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml` が存在すること。
存在しない場合は先に `/adapt-aidev-analyze <project_root>` を実行してください。

## 実行手順

`adapt-aidev/agents/domain-modeler.md` のプロンプトに従い、以下を実行する。

1. `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml` を読み込む
2. 戦略DDD（境界コンテキスト・コンテキストマップ・ユビキタス言語）を設計
3. 戦術DDD（集約・エンティティ・値オブジェクト・ユースケース・リポジトリ）を設計
4. 既存コードとの実装マッピングを生成
5. 結果を `adapt-aidev/artifacts/phase-b/domain-model/index.yaml` に出力

## 出力

- `adapt-aidev/artifacts/phase-b/domain-model/index.yaml`

## 次のステップ

ドメインモデル生成後は `/adapt-aidev-task <task>` で開発案件を実行できる。
