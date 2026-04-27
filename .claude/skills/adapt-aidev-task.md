---
name: adapt-aidev-task
description: Phase C のみ実行：ドメインモデルをベースに指定された開発タスクを実装する。Phase B の実行が前提。
---

# /adapt-aidev-task 開発タスク実行（Phase C のみ）

## 使い方

```
/adapt-aidev-task <task_description>
```

例:
- `/adapt-aidev-task "LoginAction.submit() に認証ロジックを実装する"`
- `/adapt-aidev-task TODO-001`
- `/adapt-aidev-task "TodoAction.add() でTodoを保存してリダイレクトする"`

## 前提条件

以下のファイルが存在すること:
- `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml`
- `adapt-aidev/artifacts/phase-b/domain-model/index.yaml`

存在しない場合は先に `/adapt-aidev-analyze` → `/adapt-aidev-model` を実行してください。

## 実行手順

`adapt-aidev/agents/task-executor.md` のプロンプトに従い、以下を実行する。

1. `adapt-aidev/artifacts/phase-b/domain-model/index.yaml` を読み込む
2. `adapt-aidev/artifacts/phase-a/spec-inventory/index.yaml` を読み込む
3. `<task_description>` に対応するユースケース・集約・ビジネスルールを特定
4. 関連する既存コードを読み込む
5. ドメインモデルに従って実装を行う
6. 実装のレビュー（コンパイル可能性・ドメインモデル整合性）
7. 実装結果をユーザーに報告

## task_id 指定の場合

`TODO-001` のような task_id を指定した場合、`spec-inventory` の `todo_items` から対応する実装ヒントを参照する。

## 注意事項

- 既存コードのパターン・命名規則を踏襲する
- TODO(human)マーカーは実装後に削除する
- 実装後は変更ファイルと実装内容をユーザーに報告する
