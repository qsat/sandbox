# 既存仕様の配置定義

移植作業に必要な既存システムの仕様書・定義ファイルと、プロジェクトルートにおける推奨配置を定義します。

---

## 必要な既存仕様の一覧

### 1. API仕様（OpenAPI / Swagger）

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| ZF1 が呼び出す外部API定義 | `specs/openapi/{service-name}.yaml` | 必須 | api-catalog-builder, api-client-builder |
| ZF1 が提供するAPI定義（内部向け） | `specs/openapi/internal/{endpoint}.yaml` | 任意 | route-analyzer, controller-migrator |

**用途:**
- `api-catalog-builder` が `artifacts/phase-a/api-catalog.yaml` を生成する際の型定義・エンドポイント仕様として参照
- `api-client-builder` が Spring WebClient コードを生成する際のリクエスト/レスポンス型の根拠として参照

---

### 2. データベーススキーマ / ERD

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| DDLファイル（CREATE TABLE 等） | `specs/db/ddl/*.sql` | 必須 | domain-modeler |
| ERDイメージまたはPlantUML | `specs/db/erd.png` / `specs/db/erd.puml` | 推奨 | domain-modeler |
| マスタデータ定義 | `specs/db/master/*.csv` | 任意 | domain-modeler, service-builder |

**用途:**
- `domain-modeler` が `artifacts/phase-b/domain-model.yaml` のエンティティ定義・リレーション・フィールド型を確定する際に参照
- `service-builder` がリポジトリ層（JPA エンティティ・リポジトリインタフェース）を生成する際に参照

---

### 3. 画面設計 / ワイヤーフレーム

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| 画面設計書（Excel / PDF） | `specs/screens/{screen_id}/design.pdf` | 推奨 | template-analyzer, template-migrator |
| ワイヤーフレーム画像 | `specs/screens/{screen_id}/wireframe.png` | 任意 | template-migrator |
| 画面項目定義（CSV / YAML） | `specs/screens/{screen_id}/items.yaml` | 推奨 | controller-migrator, template-migrator |

**用途:**
- `template-analyzer` が Smarty テンプレートと設計書の対応を確認するために参照
- `template-migrator` が Thymeleaf テンプレートを生成する際のレイアウト・項目の根拠として参照

---

### 4. ゴールデン HTML スナップショット

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| 移植前の正常レスポンス HTML | `snapshots/{screen_id}/expected.html` | 必須 | snapshot-comparator |
| 正常系パラメータセット | `snapshots/{screen_id}/params.yaml` | 必須 | snapshot-comparator |
| エラー系スナップショット | `snapshots/{screen_id}/error-{code}.html` | 任意 | snapshot-comparator |

**用途:**
- `snapshot-comparator` が移植後の HTML レンダリング結果と比較し、差分を `dod-results/{screen_id}-snapshot.yaml` に記録
- 動的要素（日時・乱数・CSRF トークン等）は `params.yaml` の `ignore_selectors` で除外設定

```yaml
# snapshots/{screen_id}/params.yaml の例
screen_id: property-detail
request:
  method: GET
  path: /property/detail
  params:
    id: "12345"
ignore_selectors:
  - "#csrf-token"
  - ".timestamp"
  - "[data-nonce]"
```

---

### 5. 業務ロジック仕様書

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| バリデーションルール定義 | `specs/logic/validation.md` | 推奨 | service-builder, dod-checker |
| 計算式・業務ルール | `specs/logic/{domain}.md` | 推奨 | service-builder |
| ステートマシン図 | `specs/logic/state-{entity}.md` | 任意 | service-builder |

**用途:**
- `service-builder` がサービス層のビジネスロジックを移植する際の仕様根拠として参照
- `dod-checker` のDoDチェック項目「業務ロジック等価性」の判定基準として参照

---

### 6. テストフィクスチャ / モックデータ

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| DBフィクスチャ（SQL / YAML） | `specs/fixtures/{screen_id}/*.sql` | 推奨 | test-generator |
| APIモックレスポンス | `specs/mocks/{service-name}/{endpoint}.json` | 推奨 | test-generator, api-client-builder |
| 入力データパターン集 | `specs/fixtures/{screen_id}/inputs.yaml` | 任意 | test-generator |

**用途:**
- `test-generator` が JUnit テストのセットアップデータとして参照
- `api-client-builder` が WireMock スタブを生成する際のレスポンス雛形として参照

---

### 7. 認証・認可仕様

| ファイル | 配置先 | 必須/任意 | 参照エージェント |
|---------|-------|---------|----------------|
| ロール・権限マトリクス | `specs/auth/roles.yaml` | 必須（認証有の場合） | controller-migrator, session-scanner |
| セッション設計書 | `specs/auth/session.md` | 推奨 | session-scanner |

**用途:**
- `session-scanner` がセッション変数の用途・スコープを判定する際に参照
- `controller-migrator` が `@PreAuthorize` 等の Spring Security アノテーションを付与する際の根拠として参照

---

## プロジェクトルートの完全なディレクトリ構造

```
{プロジェクトルート}/
│
├── specs/                         ← 既存仕様（git管理推奨）
│   ├── openapi/                   ← 外部API定義（OpenAPI 3.0 YAML）
│   │   ├── {service-name}.yaml
│   │   └── internal/
│   ├── db/                        ← DB定義
│   │   ├── ddl/
│   │   ├── erd.puml
│   │   └── master/
│   ├── screens/                   ← 画面設計
│   │   └── {screen_id}/
│   │       ├── design.pdf
│   │       └── items.yaml
│   ├── logic/                     ← 業務ロジック仕様
│   ├── auth/                      ← 認証・認可仕様
│   ├── fixtures/                  ← テストフィクスチャ
│   └── mocks/                     ← APIモックデータ
│
├── snapshots/                     ← ゴールデンHTML（git管理推奨）
│   └── {screen_id}/
│       ├── expected.html
│       ├── params.yaml
│       └── error-*.html
│
├── {zf1-source}/                  ← 移植元 PHP（source_root に指定）
├── spring-boot-app/               ← 移植先 Spring Boot（output_dir）
│
├── mapping-rules/                 ← 変換辞書（Phase B で生成、git管理推奨）
├── artifacts/                     ← Phase A/B 成果物（gitignore推奨）
│   ├── phase-a/                   ← routing/template/api-catalog/session inventory
│   └── phase-b/                   ← domain-model
├── context-pack/                  ← コンテキストパック（gitignore推奨）
├── flags/                         ← エージェント間フラグ（gitignore推奨）
├── dod-results/                   ← 検証結果（gitignore推奨）
├── human-queue/                   ← エスカレーション（gitignore推奨）
├── tasks.yaml                     ← Orchestrator 状態（gitignore推奨）
└── final_report.yaml              ← 移植レポート（gitignore推奨）
```

---

## エージェントと仕様の対応マトリクス

| エージェント | specs/openapi | specs/db | specs/screens | snapshots | specs/logic | specs/fixtures | specs/auth |
|------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| api-catalog-builder | ◎ | | | | | | |
| domain-modeler | | ◎ | | | | | |
| template-analyzer | | | ○ | | | | |
| session-scanner | | | | | | | ○ |
| mapping-rule-author | ○ | ○ | ○ | | ○ | | |
| context-packer | ○ | ○ | ○ | | ○ | | ○ |
| controller-migrator | ○ | | | | | | ◎ |
| template-migrator | | | ◎ | | | | |
| service-builder | | ◎ | | | ◎ | | |
| api-client-builder | ◎ | | | | | ○ | |
| dod-checker | | | | | ◎ | | |
| snapshot-comparator | | | | ◎ | | | |
| test-generator | | | | | | ◎ | |

凡例: ◎ 主要参照 / ○ 補助参照

---

## context-pack.yaml への組み込み

`context-packer` は各画面の `context-pack/{screen_id}.yaml` に以下の形式で仕様参照を含めます。

```yaml
specs:
  openapi_refs:
    - specs/openapi/property-api.yaml
    - specs/openapi/user-api.yaml
  db_tables:
    - properties
    - property_images
  screen_design: specs/screens/property-detail/items.yaml
  validation_rules: specs/logic/property.md
  auth_required: true
  roles:
    - ROLE_USER
    - ROLE_ADMIN
```

---

## 優先度と移植開始の前提条件

### フルパイプライン開始前に必須

- `specs/db/ddl/` にDDLが揃っていること（`domain-modeler` の入力）
- 呼び出す外部APIの `specs/openapi/` が揃っていること（`api-client-builder` の入力）
- `snapshots/{screen_id}/` が少なくとも1画面分揃っていること（`snapshot-comparator` の動作確認用）

### 移植品質向上に推奨

- `specs/screens/{screen_id}/items.yaml` の画面項目定義
- `specs/logic/` の業務ロジック仕様
- `specs/fixtures/` のテストデータ

### なくても移植は進むが精度が下がる

- ワイヤーフレーム画像
- マスタデータ
- ステートマシン図
