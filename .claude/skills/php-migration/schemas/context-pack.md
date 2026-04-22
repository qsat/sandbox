# コンテキストパック スキーマ定義

`context-packer` エージェントが画面単位で生成する入力パック。
移植・検証の各エージェントはこのファイル **のみ** を参照して作業を完結させる。

---

## ファイル配置

```
context-pack/
└── {screen_id}.yaml    # 例: property-detail.yaml, search-result.yaml
```

---

## スキーマ

```yaml
# ───────────────────────────────────────────────
# META
# ───────────────────────────────────────────────
meta:
  screen_id: string          # 一意識別子 例: property-detail
  screen_name: string        # 人が読む名称 例: 物件詳細
  priority: int              # 移植順序（低い値が先）
  dependencies:              # 先に移植が完了している必要がある screen_id
    - string

# ───────────────────────────────────────────────
# ROUTING  （route-analyzer 出力より抜粋）
# ───────────────────────────────────────────────
routing:
  - method: GET | POST
    url_pattern: string      # 例: /property/:id
    module: string
    controller: string
    action: string
    auth_required: boolean
    query_params:            # 任意クエリパラメータ
      - name: string
        type: string
        required: boolean

# ───────────────────────────────────────────────
# SOURCE FILES  （テンプレートインベントリより抜粋）
# ───────────────────────────────────────────────
source:
  controller:
    path: string             # 例: application/controllers/PropertyController.php
    content: string          # ファイル全文（base64 or インライン）

  templates:
    - path: string           # 例: application/views/scripts/property/detail.phtml
      role: main | layout | partial
      content: string

  helpers:
    - class: string          # 例: Zend_View_Helper_PropertyBadge
      path: string
      content: string

# ───────────────────────────────────────────────
# API CALLS  （api-catalog より抜粋）
# ───────────────────────────────────────────────
api_calls:
  - call_id: string          # 例: get-property-detail
    endpoint: string         # 例: /v2/properties/{id}
    method: GET | POST
    called_from: string      # controller#action
    request:
      path_params:
        - name: string
          type: string
      query_params:
        - name: string
          type: string
          required: boolean
      body_schema: object    # JSONスキーマ（POSTの場合）
    response:
      success_schema: object
      error_codes:
        - code: int
          meaning: string
          handling: string   # 例: redirect-to-404, show-error-banner

# ───────────────────────────────────────────────
# SESSION / COOKIE 利用
# ───────────────────────────────────────────────
session_usage:
  - namespace: string        # Zend_Session_Namespace名
    key: string
    operation: read | write | delete
    location: string         # controller#action

cookie_usage:
  - name: string
    operation: read | write | delete
    location: string

# ───────────────────────────────────────────────
# DOMAIN OBJECTS  （domain-modeler 出力より抜粋）
# ───────────────────────────────────────────────
domain_objects:
  - class_name: string       # 例: PropertyDetail
    package: string          # 例: com.example.property.domain
    fields:
      - name: string
        type: string         # Java型 例: String, Long, List<ImageUrl>
        source_path: string  # APIレスポンスのJSONパス 例: $.data.images[*].url
    value_objects:
      - string               # 使用するValueObjectクラス名

# ───────────────────────────────────────────────
# MAPPING RULES  （mapping-rules.yaml より該当抜粋）
# ───────────────────────────────────────────────
mapping_rules:
  controller:
    - zf1_pattern: string    # 例: "$this->_redirect('/search')"
      spring_pattern: string # 例: "return \"redirect:/search\";"
      note: string

  template:
    - zf1_pattern: string    # 例: "<?php if ($var): ?>"
      spring_pattern: string # 例: "th:if=\"${var}\""
      note: string

  helper:
    - zf1_class: string      # 例: Zend_View_Helper_Url
      spring_equivalent: string # 例: "@{/path}" (Thymeleaf URL式)
      note: string

  api_client:
    - pattern: string        # 例: Zend_Http_Client GET
      spring_pattern: string # 例: webClient.get().uri(...).retrieve()
      note: string

# ───────────────────────────────────────────────
# TARGET SPEC  （移植先の設計）
# ───────────────────────────────────────────────
target:
  base_package: string       # 例: com.example.property
  controller:
    class_name: string       # 例: PropertyDetailController
    package: string
  service:
    - class_name: string     # 例: PropertyDetailService
      package: string
  templates:
    - path: string           # 例: templates/property/detail.html
      role: main | layout | fragment
  api_clients:
    - class_name: string     # 例: PropertyApiClient
      package: string

# ───────────────────────────────────────────────
# DOD（Definition of Done）  ← dod-checker が評価する
# ───────────────────────────────────────────────
dod:
  display_items:
    - id: string
      description: string    # 例: 物件名が表示される
      selector: string       # CSSセレクタ 例: h1.property-name
      expected: string       # 期待値またはnot-empty

  transitions:
    - trigger: string        # 例: 問い合わせボタンクリック
      expected_url_pattern: string

  api_calls_expected:
    - call_id: string        # api_calls[].call_id と対応
      assert_called: boolean
      assert_params: object  # 期待リクエストパラメータ

  snapshot_baseline:
    path: string             # ゴールデンHTMLスナップショットのパス
    diff_threshold_pct: float # 許容差分率 例: 0.5

  test_scenarios:
    - id: string
      description: string    # 例: 存在しない物件IDで404が返る
      input: object
      expected_status: int
      expected_behavior: string

  non_functional:
    response_time_ms: int    # 閾値
    error_rate_pct: float
```

---

## エージェント別 参照フィールド一覧

| エージェント | 必須フィールド | 任意フィールド |
|------------|-------------|-------------|
| controller-migrator | meta, routing, source.controller, api_calls, mapping_rules.controller, target.controller | session_usage, cookie_usage |
| template-migrator | meta, source.templates, source.helpers, mapping_rules.template, mapping_rules.helper, target.templates | domain_objects |
| service-builder | meta, source.controller, domain_objects, api_calls, target.service | session_usage |
| api-client-builder | meta, api_calls, mapping_rules.api_client, target.api_clients | — |
| dod-checker | meta, dod.display_items, dod.transitions, dod.api_calls_expected | — |
| snapshot-comparator | meta, dod.snapshot_baseline | — |
| code-reviewer | meta, target.* | mapping_rules.* |
| test-generator | meta, dod.test_scenarios, api_calls, target.* | — |

---

## サンプル（物件詳細画面・抜粋）

```yaml
meta:
  screen_id: property-detail
  screen_name: 物件詳細
  priority: 20
  dependencies:
    - common-layout
    - property-search-result

routing:
  - method: GET
    url_pattern: /property/:id
    module: default
    controller: Property
    action: detail
    auth_required: false
    query_params:
      - name: from
        type: string
        required: false

api_calls:
  - call_id: get-property-detail
    endpoint: /v2/properties/{id}
    method: GET
    called_from: Property#detail
    request:
      path_params:
        - name: id
          type: long
    response:
      success_schema:
        $ref: schemas/property-detail-response.json
      error_codes:
        - code: 404
          meaning: 物件が存在しない
          handling: redirect-to-404

dod:
  display_items:
    - id: property-name
      description: 物件名が表示される
      selector: h1.property-name
      expected: not-empty
    - id: price
      description: 価格が表示される
      selector: .price-value
      expected: not-empty

  transitions:
    - trigger: 問い合わせボタンクリック
      expected_url_pattern: /inquiry\?property_id=\d+

  api_calls_expected:
    - call_id: get-property-detail
      assert_called: true
      assert_params:
        id: "{{path.id}}"

  snapshot_baseline:
    path: snapshots/property-detail-baseline.html
    diff_threshold_pct: 0.5

  test_scenarios:
    - id: not-found
      description: 存在しない物件IDで404
      input:
        path:
          id: 9999999999
      expected_status: 404
      expected_behavior: 404ページにリダイレクト

  non_functional:
    response_time_ms: 800
    error_rate_pct: 0.1
```
