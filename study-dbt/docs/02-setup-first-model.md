# 第2章 環境構築と最初のモデル

> **この章のゴール**
> - 自分の dbt プロジェクト `my_coffee_shop` を作り、DuckDB に接続する
> - `dbt_project.yml` と `profiles.yml` の役割の違いを説明できる
> - 最初のモデルを書き、`dbt run` でビューを作り、`dbt show` で中身を確認する
> - dbt v2 の静的解析で、列名の間違いを **実行前に** 見つける体験をする

## 2.1 たとえ: 2つの設定ファイル

| dbt | Spring Boot | Node.js |
|---|---|---|
| `dbt_project.yml`（**何を**ビルドするか） | `build.gradle` / `pom.xml` | `package.json` |
| `profiles.yml`（**どこに**接続するか） | `application-{profile}.yml` | `.env` / `config/{env}.json` |
| target（`dev` / `prod`） | `spring.profiles.active` | `NODE_ENV` |

`dbt_project.yml` はプロジェクトと一緒に Git 管理します。
`profiles.yml` は接続情報（パスワードなど）を含むため、本来は `~/.dbt/profiles.yml` に置いて Git 管理しません。
DuckDB はローカルファイルなので秘密情報がなく、この教材ではプロジェクト直下に置きます。

## 2.2 ハンズオン: プロジェクトを作る

[README のセットアップ](../README.md#セットアップ) で dbt v2 と `.venv` を用意してから始めます。

```bash
cd study-dbt
dbt --version          # dbt 2.0.12 と表示されれば OK
```

### `dbt init` で雛形を作る

```bash
dbt init --project-name my_coffee_shop --skip-profile-setup
```

`--skip-profile-setup` を付けると、対話形式の接続設定をスキップします（接続設定は次で手書きします）。
dbt v2 の `init` は、架空のジュースショップ「jaffle shop」のサンプル一式を生成します。

```text
my_coffee_shop/
├── dbt_project.yml
├── packages.yml
├── models/staging/ , models/marts/   ← サンプル
├── macros/ , seeds/                   ← サンプル
├── .vscode/extensions.json            ← VS Code 拡張のおすすめ設定
└── README.md
```

サンプルを眺めてみるのも勉強になりますが、この教材では自分で一から作るので削除します。

```bash
cd my_coffee_shop
rm -r models macros seeds packages.yml
```

### `dbt_project.yml` を書き換える

`dbt_project.yml` を、次の内容で置き換えます。

```yaml
name: my_coffee_shop
profile: my_coffee_shop          # profiles.yml のどの接続設定を使うか

model-paths: ["models"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]
test-paths: ["tests"]
analysis-paths: ["analyses"]

clean-targets: ["target", "dbt_packages"]

models:
  my_coffee_shop:
    +static_analysis: strict     # SQL を実行前に厳しく検査する（2.4 節）
    +materialized: view          # モデルはビューとして作る（第10章）
```

### `profiles.yml` を書く

`my_coffee_shop/profiles.yml` を作成します。

```yaml
my_coffee_shop:              # ← dbt_project.yml の profile: と一致させる
  target: dev
  outputs:
    dev:
      type: duckdb
      path: my_coffee_shop.duckdb   # DuckDB ファイル（無ければ作られる）
      schema: dev
      threads: 4
```

dbt は `profiles.yml` を、プロジェクトのディレクトリや `~/.dbt/` から探します。`--profiles-dir` で場所を明示することもできます。

### 生データをロードする

自分用の DuckDB ファイルに生データを入れます（`study-dbt/` で実行）。

```bash
cd ..
.venv/bin/python scripts/load_raw.py --day day1 --db my_coffee_shop/my_coffee_shop.duckdb
# または: make load-day1 PROJECT=my_coffee_shop
cd my_coffee_shop
```

### 接続確認: `dbt debug`

```bash
dbt debug
```

```text
 Debugging profile: dev
 Debugging dbt version: 2.0.12
 Debugging adapter type: duckdb (remote)
 ...
 Debugging connection test: OK
  Debugged All checks passed!
```

`dbt debug` は、DB 接続の疎通確認です。Spring Boot の起動時に DataSource へ接続できるかを確かめるのと同じです。
エラーになったら、`profile:` の名前のずれと、`profiles.yml` の場所をまず疑ってください。

## 2.3 最初のモデルを書く

### モデル = SELECT 文 1つ

`models/stg_shop__orders.sql` を作ります。

```sql
select
    id                  as order_id,
    user_id             as customer_id,
    order_date          as ordered_on,
    lower(trim(status)) as order_status,
    shipping_fee        as shipping_fee_jpy,
    created_at          as ordered_at,
    updated_at
from raw.orders
```

> ⚠️ `from raw.orders` とテーブル名を直書きしているのは **わざと** です。第3章で `source()` に置き換えます。

### `dbt run`

```bash
dbt run
```

```text
 Succeeded model dev.stg_shop__orders (view) [1 of 1 in 0.04s]
==================== Execution Summary =====================
Finished 'run' successfully for target 'dev' [834ms]
Processed: 1 model
Summary: 1 total | 1 success
```

**ファイル名がそのままテーブル（ビュー）名** になり、`profiles.yml` の `schema: dev` に作られました。
`CREATE VIEW` 文は一行も書いていません。

### dbt が実際に投げた SQL を見る

dbt が何をしたかは `target/` ディレクトリで確認できます。TS の `dist/`、Java の `build/classes/` にあたる場所です。

```bash
cat target/compiled/my_coffee_shop/models/stg_shop__orders.sql   # Jinja 展開後の SELECT
cat target/run/my_coffee_shop/models/stg_shop__orders.sql        # 実際に実行された DDL
```

`target/run/` を開くと、`create view "my_coffee_shop"."dev"."stg_shop__orders__dbt_tmp" as (...)` のように、
dbt が DDL で SELECT を包んでいることが分かります。

### `dbt show` で結果を確認

```bash
dbt show --select stg_shop__orders --limit 3
dbt show --inline "select order_status, count(*) from dev.stg_shop__orders group by 1"
```

```text
┌──────────┬─────────────┬────────────┬──────────────┬──────────────────┬─────────────────────┬─────
│ order_id ┆ customer_id ┆ ordered_on ┆ order_status ┆ shipping_fee_jpy ┆ ordered_at          ┆ ...
╞══════════╪═════════════╪════════════╪══════════════╪══════════════════╪═════════════════════╪═════
│ 1        ┆ 197         ┆ 2025-01-01 ┆ completed    ┆ 550              ┆ 2025-01-01T07:00:57 ┆ ...
│ 2        ┆ 180         ┆ 2025-01-01 ┆ completed    ┆ 550              ┆ 2025-01-01T04:03:24 ┆ ...
│ 3        ┆ 288         ┆ 2025-01-01 ┆ returned     ┆ 550              ┆ 2025-01-01T22:23:55 ┆ ...
└──────────┴─────────────┴────────────┴──────────────┴──────────────────┴─────────────────────┴─────
```

`dbt show` は SELECT を実行して結果を表示するだけで、テーブルは作りません。
REPL や `console.log` デバッグのような感覚で使えます。

## 2.4 静的解析: 間違いを「実行前に」見つける

`dbt_project.yml` に書いた `+static_analysis: strict` の効果を体験します。
`stg_shop__orders.sql` の `user_id` を、わざと `user_idd` に打ち間違えてから、**コンパイルだけ** してみます。

```bash
dbt compile -s stg_shop__orders
```

```text
[error] [UnresolvedIdentifier (dbt0227)]: No column user_idd found.
Available are my_coffee_shop.raw.orders.user_id, my_coffee_shop.raw.orders.id, ...
  --> models/stg_shop__orders.sql:3:5
```

dbt v2 は、モデルが読むテーブルの列定義を取得し、SQL を解析して「その列は存在しない」と **候補つきで** 教えてくれます。
DB で SQL を実行する前の段階です。TS で存在しないプロパティにアクセスしたときのコンパイルエラーと同じ体験です。

| `static_analysis` | 動き |
|---|---|
| `strict` | 列や型の検査を最も厳しく行う。この教材の設定（v2 の `dbt init` の既定でもある） |
| `baseline` | 基本的な検査だけ行う |
| `off` | 解析しない（v1 と同じく、DB に投げて初めてエラーに気づく） |

確認したら、`user_id` に戻してください。

## 2.5 dbt の主要コマンド

| コマンド | 何をする | アプリ開発でいうと |
|---|---|---|
| `dbt debug` | 接続確認 | DataSource の疎通確認 |
| `dbt parse` | プロジェクトを解析（DB に接続しない） | 構文チェック |
| `dbt compile` | Jinja を展開した SQL を `target/compiled/` に出力。v2 では静的解析も行う | `tsc --noEmit` |
| `dbt run` | モデルを実行してテーブル / ビューを作る | ビルド |
| `dbt test` | テストを実行 | `npm test` |
| `dbt seed` | CSV をロード | テストフィクスチャ投入 |
| `dbt snapshot` | スナップショットを取る | （第11章） |
| `dbt build` | seed → run → snapshot → test を **DAG 順に** まとめて実行 | `mvn verify` |
| `dbt show` | SELECT を実行して結果を表示 | REPL |
| `dbt ls` | 選択されたノードを一覧表示 | `gradle tasks` |
| `dbt docs generate / serve` | ドキュメントサイト生成・表示 | Javadoc |
| `dbt lint` / `dbt fmt` | SQL の Lint・自動整形（v2 で追加。第12章） | ESLint / Prettier |
| `dbt clean` | `target/` などを削除 | `mvn clean` |

## 演習

**2-1.** `models/stg_shop__customers.sql` を作り、`raw.customers` から次の列を持つビューを作ってください。
`customer_id`、`customer_name`、`email`（前後空白を除去して小文字化）、`prefecture`、`created_at`、`updated_at`

<details><summary>解答</summary>

```sql
select
    id                 as customer_id,
    name               as customer_name,
    lower(trim(email)) as email,
    trim(prefecture)   as prefecture,
    created_at,
    updated_at
from raw.customers
```

`dbt run` で `Summary: 2 total | 2 success` になれば完成です。`dbt run --select stg_shop__customers` とすると、このモデルだけを実行できます。

</details>

**2-2.** `dbt_project.yml` の `+materialized: view` を `table` に変えて `dbt run` し、`target/run/` の SQL がどう変わるか確認してください。確認できたら `view` に戻します。

<details><summary>解答</summary>

`create view ... as (...)` が `create table ... as (...)` に変わります。
**SELECT 文は1文字も変えずに、実体化の方法だけを設定で切り替えられる** のがポイントです。第10章で詳しく扱います。

</details>

**2-3.** 設定ファイルにわざと間違いを入れて（例: `profile: my_cofee_shop` とタイプミス）、`dbt debug` がどんなエラーを出すか確認してください。

<details><summary>解答</summary>

`Profile 'my_cofee_shop' not found in profiles.yml` と表示されます。

</details>

**2-4.** `static_analysis` を `off` にしてから、2.4 節と同じ打ち間違いで `dbt compile` と `dbt run` を実行してください。エラーはいつ、どこから出ますか？

<details><summary>解答</summary>

`dbt compile` は成功してしまい、`dbt run` で DuckDB に SQL を投げた時点で、DuckDB のエラー（列が見つからない）として失敗します。
静的解析があると、**DB に問い合わせる前**（＝ CI の早い段階や、エディタ上）で気づけます。
大規模な DWH では、間違った SQL を投げること自体に時間とお金がかかるので、この差は大きくなります。

</details>

## つまずきポイント

- **`Profile '...' not found in profiles.yml`** … `dbt_project.yml` の `profile:` と、`profiles.yml` の一番上のキーが一致していません。
- **`Trying to read a database file with version number ...`** … ロードスクリプトの DuckDB（Python）と、dbt v2 に内蔵の DuckDB のバージョンがずれています。`.venv` を作り直して `requirements.txt` のバージョンを入れてください（README 参照）。
- **`Could not set lock on file`** … DuckDB は、書き込みできるプロセスが1つだけです。DBeaver などの GUI で同じファイルを開いていると、dbt から書き込めません。GUI 側の接続を閉じてください。
- **SQL の末尾にセミコロンを書いてエラー** … dbt はモデルを `create view ... as (<あなたのSQL>)` のように包みます。末尾の `;` は書かないでください。
- **`raw.orders` が無いと言われる** … `load_raw.py` の `--db` で、自分の DuckDB ファイルを指定してロードしたか確認してください。

## まとめ

- `dbt_project.yml` は **何を** ビルドするか、`profiles.yml` は **どこに** 接続するか
- モデルは SELECT 文1つ。ファイル名がテーブル名になり、DDL は dbt が生成する
- `target/compiled/` と `target/run/` を見れば、dbt が実際に投げた SQL が分かる
- v2 の `static_analysis: strict` で、列名の間違いや型の不一致を実行前に検出できる

⬅️ 前章: [第1章](01-what-is-dbt.md) ／ ➡️ 次章: [第3章 model・ref・source・seed](03-models-ref-source.md)
