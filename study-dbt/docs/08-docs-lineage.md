# 第8章 ドキュメントとリネージ

> **この章のゴール**
> - YAML の `description` と doc block で、モデルと列のドキュメントを書ける
> - `dbt docs generate / serve` でデータカタログを生成し、リネージグラフを読める
> - exposure で「dbt の外側の利用者」を宣言し、影響範囲を可視化できる
> - dbt が出力するアーティファクト（`manifest.json` など）の役割を知る

## 8.1 たとえ: Javadoc / TypeDoc ＋ 依存グラフ

| dbt | TS / Java |
|---|---|
| YAML の `description` | Javadoc / TSDoc のコメント |
| doc block（`{% docs %}`） | 複数箇所から参照する共通ドキュメント（`{@link}` 先の説明） |
| `dbt docs generate` | `javadoc` / `typedoc` コマンド |
| リネージグラフ | IDE の「呼び出し階層」/ モジュール依存グラフ |
| exposure | 「この API を使っているクライアント一覧」 |
| `manifest.json` | コンパイラが出力する AST / シンボルテーブル |

dbt のドキュメントの強みは、**コードと同じリポジトリにあり、コードから自動生成される** ことです。
Wiki に手で書いたドキュメントは、すぐに古くなります。dbt のドキュメントは、ビルドのたびに最新のコードから作り直されます。

## 8.2 description を書く

```yaml
models:
  - name: fct_orders
    description: |
      注文ファクト。**1行 = 1注文**。
      キャンセルを含む全注文を持ち、`is_valid_order` で有効な注文を判定する。
    columns:
      - name: order_total_jpy
        description: 注文合計 = 商品小計 + 送料
```

- Markdown が使えます（太字、表、コードブロック、リンク）
- **粒度、業務上の定義、計算式、注意点** を書きましょう。「列名を日本語にしただけ」の説明は価値が低いです

| ❌ 価値が低い | ✅ 価値が高い |
|---|---|
| `order_total_jpy`: 注文合計金額 | 注文合計 = 商品小計 + 送料。税込。キャンセル注文も値を持つので、売上集計では `is_valid_order` で絞ること |

## 8.3 doc block: 長い説明・共通の説明

同じ説明を複数のモデルで使いたいとき、または表を含む長い説明を書きたいときは、**doc block** を使います。
`models/` 配下の `.md` ファイルに書きます。

```markdown
<!-- models/marts/core/_core__docs.md -->
{% docs customer_segment %}

注文回数による顧客セグメント。マーケティング施策の出し分けに使う。

| 値 | 条件（有効な注文数） | 想定する施策 |
|---|---|---|
| `prospect` | 0 回 | 初回購入クーポン |
| `new` | 1 回 | 2回目購入の後押し |
| `repeat` | 2 〜 4 回 | 定期便の案内 |
| `loyal` | 5 回以上 | 限定ロットの先行案内 |

{% enddocs %}
```

```yaml
      - name: customer_segment
        description: '{{ doc("customer_segment") }}'
```

完成版の [`_core__docs.md`](../coffee_shop/models/marts/core/_core__docs.md) には、`order_status` の状態遷移図も書いてあります。
**ユビキタス言語の辞書**（第4章）を、ここに育てていくイメージです。

## 8.4 ドキュメントサイトを生成する

```bash
dbt docs generate      # target/ に manifest.json と catalog.json を生成
dbt docs serve --port 8080
```

`study-dbt/` で `make docs` を実行しても同じです。

### 画面の見方

| 場所 | 内容 |
|---|---|
| 左ペイン Project タブ | ディレクトリ構成どおりのツリー |
| 左ペイン Database タブ | DB のスキーマ構成どおりのツリー |
| モデルのページ | 説明、列一覧（型・説明・テスト）、依存関係、SQL（ソースとコンパイル後） |
| 右下の青いボタン | **リネージグラフ**（DAG） |

### リネージグラフの使い方

グラフ画面の下部にある `--select` 欄には、第3章の選択構文がそのまま使えます。

- `+fct_monthly_revenue` … 月次売上が **何から作られているか**（上流）
- `stg_shop__payments+` … 決済の staging を変えると **どこに影響するか**（下流）
- `+dim_customers+` … 顧客ディメンションを中心とした全体像

**「この列の定義を変えたら、どのダッシュボードが壊れるか」に、コードを読まずに答えられる** のがリネージの価値です。
IDE で「この関数の呼び出し元を検索」するのと同じ使い方をします。

## 8.5 exposure: dbt の外側の利用者を宣言する

dbt のリネージは、通常 marts で終わります。しかし実際には、その先に BI ダッシュボード、機械学習モデル、業務アプリへのリバース ETL などが続きます。
**exposure** で、それらを宣言できます。

```yaml
# models/marts/_exposures.yml
exposures:
  - name: monthly_sales_dashboard
    label: 月次売上ダッシュボード
    type: dashboard            # dashboard / notebook / analysis / ml / application
    maturity: high             # high / medium / low
    url: https://bi.example.com/dashboards/monthly-sales
    description: 経営会議で毎月参照する売上ダッシュボード
    depends_on:
      - ref('fct_monthly_revenue')
      - ref('dim_customers')
    owner:
      name: Finance Analytics Team
      email: finance-analytics@example.com
```

- リネージグラフの終端に、オレンジ色のノードとして表示されます
- `dbt build -s +exposure:monthly_sales_dashboard` で、**このダッシュボードに必要なものだけ** をビルド・テストできます

```bash
dbt ls -s +exposure:monthly_sales_dashboard
```

マイクロサービスで「このサービスの API を呼んでいるクライアント一覧」を管理しておくと、破壊的変更の影響を見積もれます。exposure はその dbt 版です。

## 8.6 アーティファクト: dbt が出力する JSON

`target/` には、ドキュメントサイトの元になる JSON が出力されます。

| ファイル | 中身 | 使い道 |
|---|---|---|
| `manifest.json` | プロジェクトの完全な定義（全ノード、依存関係、設定、SQL） | Slim CI（第12章）、外部ツール連携、自作の Lint |
| `catalog.json` | DB から取得した実際の列と型 | ドキュメントサイトの列情報 |
| `run_results.json` | 直近の実行結果（成否、所要時間、行数） | 監視・通知（第13章）、`dbt retry` |
| `sources.json` | source freshness の結果 | 鮮度の監視（第13章） |

`manifest.json` は、コンパイラが出力する AST やシンボルテーブルのようなものです。
これを読めば「`description` が空のモデルを一覧する」「`ref` されていない孤立モデルを探す」といったチェックを自作できます。

```bash
# description が空の marts モデルを一覧する（Python で manifest.json を読む例）
python3 -c "
import json
m = json.load(open('target/manifest.json'))
for n in m['nodes'].values():
    if n['resource_type'] == 'model' and 'marts' in n['path'] and not n['description']:
        print(n['name'])
"
```

> 💡 こうしたドキュメント品質のチェックを自動化するパッケージに **dbt-project-evaluator**（dbt Labs 製）があります。
> 「主キーテストが無いモデル」「marts から source を直接参照している」などのアンチパターンを検出できます。

## 8.7 ハンズオン

1. `my_coffee_shop` の marts すべてに `description` を書く。粒度を必ず含める
2. `customer_segment` の doc block を作って参照する
3. `models/marts/_exposures.yml` を作り、自分の考えたダッシュボードを1つ宣言する
4. `dbt docs generate && dbt docs serve` で確認し、リネージグラフで `+exposure:<name>` を表示する

## 演習

**8-1.** リネージグラフを使って、「`stg_shop__products` を変更したとき、影響を受けるモデルと exposure」をすべて挙げてください。

<details><summary>解答</summary>

`dbt ls -s stg_shop__products+ --resource-type model --resource-type exposure` でも確認できます。
`int_order_lines__joined_products` → `fct_orders`、`fct_order_lines` → `dim_customers` → `fct_monthly_revenue` → `monthly_sales_dashboard`、さらに `dim_products` も影響を受けます。
商品マスタの変更が、`fct_orders` の小計を経由して **月次売上ダッシュボードにまで波及しうる** ことが分かります。

</details>

**8-2.** `manifest.json` を読み、テストが1つも付いていないモデルを一覧するスクリプトを書いてください。

<details><summary>解答例</summary>

```python
import json
m = json.load(open("target/manifest.json"))
tested = set()
for n in m["nodes"].values():
    if n["resource_type"] == "test":
        tested.update(n["depends_on"]["nodes"])
for uid, n in m["nodes"].items():
    if n["resource_type"] == "model" and uid not in tested:
        print(n["name"])
```

完成版では、ephemeral な intermediate モデル2つが表示されるはずです（テストは下流の `fct_orders` で行っています）。

</details>

## つまずきポイント

- **`dbt docs serve` で列の型が表示されない** … `catalog.json` は DB を見て作られます。`dbt docs generate` の前に `dbt run` でテーブルを作っておく必要があります。
- **doc block が反映されない** … `.md` ファイルが `model-paths`（`models/`）配下にあるか確認してください。`{% docs 名前 %}` と `doc("名前")` の名前も一致させます。
- **YAML で `{{ doc(...) }}` を書いたらパースエラー** … YAML の文字列として、`'{{ doc("x") }}'` のようにクオートで囲みます。

## まとめ

- ドキュメントはコードの隣に書き、ビルドのたびに再生成される。Wiki のように古くならない
- description には **粒度・定義・計算式・注意点** を書く。doc block でユビキタス言語の辞書を育てる
- リネージグラフで影響範囲が分かる。exposure で dbt の外の利用者まで可視化する
- `manifest.json` はプロジェクトの AST。CI や品質チェックの自動化に使える

⬅️ 前章: [第7章](07-contracts-access.md) ／ ➡️ 次章: [第9章 Jinja・マクロ・パッケージ](09-jinja-macros.md)
