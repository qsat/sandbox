# Adapt AI-Dev フレームワーク

既存JavaプロジェクトをAIドリブン開発に適応させるためのエージェントフレームワーク。

## スキル（スラッシュコマンド）

| コマンド | 用途 |
|---------|------|
| `/adapt-aidev <project_root>` | フルパイプライン実行（Phase A→B→C） |
| `/adapt-aidev-analyze <project_root>` | Phase A 分析のみ（仕様抽出・現状把握） |
| `/adapt-aidev-model` | Phase B のみ（ドメインモデリング） |
| `/adapt-aidev-task <task>` | Phase C のみ（開発案件実行） |

## ディレクトリ構造

```
adapt-aidev/
├── CLAUDE.md                              ← このファイル
├── SKILL.md                               ← スキルメタデータ・コマンド仕様
├── agents/
│   ├── spec-extractor.md                  ← Phase A: コードベース+仕様書から仕様抽出
│   ├── domain-modeler.md                  ← Phase B: DDD ドメインモデリング
│   └── task-executor.md                   ← Phase C: 開発タスク実行
├── schemas/
│   ├── spec-inventory.schema.yaml         ← Phase A 出力スキーマ
│   └── domain-model.schema.yaml           ← Phase B 出力スキーマ
├── config/
│   └── defaults.yaml                      ← デフォルト設定
└── artifacts/                             ← 実行時生成（git管理）
    ├── phase-a/
    │   └── spec-inventory/
    │       └── index.yaml                 ← Phase A 出力
    └── phase-b/
        └── domain-model/
            └── index.yaml                 ← Phase B 出力
```

## フルパイプライン実行手順

### `/adapt-aidev <project_root>` が呼ばれたとき

1. **Phase A**: `agents/spec-extractor.md` のプロンプトに従い、`project_root` を解析
   - 出力: `artifacts/phase-a/spec-inventory/index.yaml`
2. **Phase B**: `agents/domain-modeler.md` のプロンプトに従い、Phase A 成果物を入力にドメインモデルを生成
   - 出力: `artifacts/phase-b/domain-model/index.yaml`
3. **Phase C**: `agents/task-executor.md` のプロンプトに従い、ユーザーから受け取ったタスクを実行
   - 出力: `project_root` 内の実装コード

### `/adapt-aidev-task <task>` が呼ばれたとき

`artifacts/phase-b/domain-model/index.yaml` が存在することを前提に Phase C のみ実行。

タスク記述例:
- `"LoginAction.submit() に認証ロジックを実装する"`
- `"TodoAction.add() でTodoを保存してリダイレクトする"`
- `"ユーザー一覧画面を追加する"`

## 重要な設計原則

1. **コードベースを正とする**: 既存コードの命名規則・パターンを継承する
2. **ドメインモデルをベースに実装**: Phase C は必ずドメインモデルを参照してから実装する
3. **既存テストを壊さない**: 実装後に既存のコンパイル・テストが通ることを確認する
4. **TODO(human)マーカーを優先**: コードベース内の `TODO(human):` マーカーが主要な開発タスク候補
