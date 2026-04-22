# 変換マッピングルール スキーマ定義

`mapping-rule-author` エージェントが生成し、`context-packer` が画面単位で抜粋する変換辞書。

---

## ファイル配置

```
mapping-rules/
├── controller.yaml    # ZF1 Controller → Spring Boot @Controller/@Service
├── template.yaml      # Smarty/PHP → Thymeleaf
├── helper.yaml        # Zend_View_Helper → Thymeleaf Dialect / utility bean
├── api-client.yaml    # Zend_Http_Client → WebClient/RestClient
└── idiom.yaml         # PHPイディオム → Javaイディオム
```

---

## 共通スキーマ（全ファイル共通）

```yaml
rules:
  - rule_id: string          # 一意識別子 例: ctrl-redirect-001
    category: string         # ファイル種別: controller | template | helper | api-client | idiom
    zf1_pattern: string      # 変換元パターン（文字列 or 正規表現）
    zf1_pattern_is_regex: boolean  # trueのとき正規表現として扱う（デフォルト: false）
    spring_pattern: string   # 変換先パターン（$1等でキャプチャグループ参照可）
    example:
      before: string         # 変換前コード例
      after: string          # 変換後コード例
    note: string             # 変換時の注意事項・制約
    tags:                    # context-packer の抜粋フィルタキー
      - string               # 例: session, redirect, partial-include, null-safe
```

### フィールド定義

| フィールド | 必須 | 説明 |
|-----------|------|------|
| rule_id | ✓ | `{category略称}-{連番3桁}` 形式。例: `ctrl-001`, `tmpl-012` |
| category | ✓ | ファイル種別と同一の文字列 |
| zf1_pattern | ✓ | 変換元。完全一致文字列 or 正規表現 |
| zf1_pattern_is_regex | — | デフォルト false |
| spring_pattern | ✓ | 変換先。正規表現キャプチャは `$1` で参照 |
| example.before | ✓ | 実コードから引用した変換前例 |
| example.after | ✓ | 変換後の期待コード |
| note | — | 変換条件・例外・副作用 |
| tags | ✓ | context-packer の抜粋に使用。最低1件必須 |

---

## context-packer の抜粋ロジック

context-packer は画面の source ファイルをスキャンし、検出した ZF1 パターンに対応する `tags` でルールを絞り込んでコンテキストパックの `mapping_rules` フィールドへ埋め込む。

```
for each detected_pattern in source_scan(screen_id):
    matched_rules = mapping-rules/*.yaml
        .filter(rule => rule matches detected_pattern)
    if matched_rules is empty:
        emit NEEDS_RULE flag (see failure-handling.md)
    else:
        append matched_rules to context_pack.mapping_rules
```

---

## NEEDS_RULE フラグ書式

未定義パターンを検出したとき context-packer が出力するフラグ。`failure-handling.md` の仕様に準拠。

```yaml
flag: NEEDS_RULE
agent: context-packer
screen_id: string
location: string        # 検出ファイルパス + 行番号 例: controllers/PropertyController.php:42
detail:
  detected_pattern: string   # 検出された未定義パターン
  category: string           # 推定カテゴリ（controller/template/...）
  suggestion: string         # 変換先の候補（任意）
timestamp: ISO8601
```

---

## サンプルエントリ

### controller.yaml（3件）

```yaml
rules:
  - rule_id: ctrl-001
    category: controller
    zf1_pattern: "$this->_redirect('$1')"
    zf1_pattern_is_regex: false
    spring_pattern: "return \"redirect:$1\";"
    example:
      before: "$this->_redirect('/search');"
      after: "return \"redirect:/search\";"
    note: クエリパラメータ付きの場合は RedirectAttributes を使用すること
    tags: [redirect]

  - rule_id: ctrl-002
    category: controller
    zf1_pattern: "$this->view->assign('(\\w+)',\\s*(.+));"
    zf1_pattern_is_regex: true
    spring_pattern: "model.addAttribute(\"$1\", $2);"
    example:
      before: "$this->view->assign('property', $property);"
      after: "model.addAttribute(\"property\", property);"
    note: Model引数をControllerメソッドシグネチャに追加すること
    tags: [view-assign]

  - rule_id: ctrl-003
    category: controller
    zf1_pattern: "$this->_forward('$1', '$2')"
    zf1_pattern_is_regex: false
    spring_pattern: "return \"forward:/$2/$1\";"
    example:
      before: "$this->_forward('error', 'common');"
      after: "return \"forward:/common/error\";"
    tags: [forward]
```

### template.yaml（3件）

```yaml
rules:
  - rule_id: tmpl-001
    category: template
    zf1_pattern: "<?php if ($1): ?>"
    zf1_pattern_is_regex: false
    spring_pattern: "th:if=\"${$1}\""
    example:
      before: "<?php if ($property->isNew()): ?>"
      after: "<div th:if=\"${property.new}\">"
    note: PHPメソッド呼び出しはThymeleafのgetter規約に変換する
    tags: [conditional]

  - rule_id: tmpl-002
    category: template
    zf1_pattern: "<?php foreach ($1 as $2): ?>"
    zf1_pattern_is_regex: false
    spring_pattern: "th:each=\"$2 : ${$1}\""
    example:
      before: "<?php foreach ($images as $image): ?>"
      after: "<div th:each=\"image : ${images}\">"
    tags: [loop]

  - rule_id: tmpl-003
    category: template
    zf1_pattern: "$this->partial('$1', array($2))"
    zf1_pattern_is_regex: false
    spring_pattern: "th:insert=\"~{fragments/$1 :: content}\""
    example:
      before: "<?= $this->partial('_badge.phtml', array('type' => $type)) ?>"
      after: "<div th:insert=\"~{fragments/badge :: content}\" th:with=\"type=${type}\">"
    note: partialファイルはfragmentsディレクトリへ移動し th:fragment を付与すること
    tags: [partial-include]
```

### idiom.yaml（2件）

```yaml
rules:
  - rule_id: idiom-001
    category: idiom
    zf1_pattern: "isset($1) ? $1 : $2"
    zf1_pattern_is_regex: false
    spring_pattern: "Optional.ofNullable($1).orElse($2)"
    example:
      before: "isset($property->name) ? $property->name : '未設定'"
      after: "Optional.ofNullable(property.getName()).orElse(\"未設定\")"
    tags: [null-safe]

  - rule_id: idiom-002
    category: idiom
    zf1_pattern: "array_filter($1, '$2')"
    zf1_pattern_is_regex: false
    spring_pattern: "$1.stream().filter($2).collect(Collectors.toList())"
    example:
      before: "array_filter($items, 'is_active')"
      after: "items.stream().filter(Item::isActive).collect(Collectors.toList())"
    tags: [collection]
```
