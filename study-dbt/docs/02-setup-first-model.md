# 第2章 環境構築と最初のモデル

> **この章のゴール**
> - 自分の dbt プロジェクト `my_coffee_shop` を作り、DuckDB に接続する
> - `dbt_project.yml` と `profiles.yml` の役割の違いを説明できる
> - 最初のモデルを書き、`dbt run` でビューを作り、`dbt show` で中身を確認する

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

`study-dbt/` で仮想環境を有効にしてから始めます。

```bash
cd study-dbt
source .venv/bin/activate
dbt --version          # Core: 1.12.x / Plugins: duckdb が表示されれば OK
```

### `dbt init` で雛形を作る

```bash
dbt init my_coffee_shop --skip-profile-setup
```

`--skip-profile-setup` を付けると、対話形式の接続設定をスキップします（接続設定は次で手書きします）。

```text
my_coffee_shop/
├── dbt_project.yml
├── models/example/          ← サンプル。あとで消す
├── analyses/  macros/  seeds/  snapshots/  tests/
└── README.md
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

dbt は `profiles.yml` を次の順で探します。

1. `--profiles-dir` オプションで指定したディレクトリ
2. 環境変数 `DBT_PROFILES_DIR`
3. **カレントディレクトリ** ← 今回はここ
4. `~/.dbt/`

### 生データをロードする

自分用の DuckDB ファイルに生データを入れます（`study-dbt/` で実行）。

```bash
python scripts/load_raw.py --day day1 --db my_coffee_shop/my_coffee_shop.duckdb
# または: make load-day1 PROJECT=my_coffee_shop
```

### 接続確認: `dbt debug`

```bash
cd my_coffee_shop
dbt debug
```

```text
  profiles.yml file [OK found and valid]
  dbt_project.yml file [OK found and valid]
  ...
  Connection test: [OK connection ok]
All checks passed!
```

`dbt debug` は、DB 接続の疎通確認です。Spring Boot の起動時に DataSource へ接続できるかを確かめるのと同じです。
エラーになったら、`profile:` の名前のずれと、`profiles.yml` の場所をまず疑ってください。

## 2.3 最初のモデルを書く

### サンプルを削除

```bash
rm -rf models/example
```

`dbt_project.yml` の末尾にある `models:` セクションも、次のように書き換えます。

```yaml
models:
  my_coffee_shop:
    +materialized: view
```

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
1 of 1 OK created sql view model dev.stg_shop__orders .......... [OK in 0.09s]
Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 REUSED=0 TOTAL=1
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
dbt show --select stg_shop__orders --limit 5
dbt show --inline "select order_status, count(*) from dev.stg_shop__orders group by 1"
```

`dbt show` は SELECT を実行して結果を表示するだけで、テーブルは作りません。
REPL や `console.log` デバッグのような感覚で使えます。

## 2.4 dbt の主要コマンド

| コマンド | 何をする | アプリ開発でいうと |
|---|---|---|
| `dbt debug` | 接続確認 | DataSource の疎通確認 |
| `dbt parse` | プロジェクトを解析（DB に接続しない） | 構文チェック |
| `dbt compile` | Jinja を展開した SQL を `target/compiled/` に出力 | `tsc` だけ実行 |
| `dbt run` | モデルを実行してテーブル / ビューを作る | ビルド |
| `dbt test` | テストを実行 | `npm test` |
| `dbt seed` | CSV をロード | テストフィクスチャ投入 |
| `dbt snapshot` | スナップショットを取る | （第11章） |
| `dbt build` | seed → run → snapshot → test を **DAG 順に** まとめて実行 | `mvn verify` |
| `dbt show` | SELECT を実行して結果を表示 | REPL |
| `dbt ls` | 選択されたノードを一覧表示 | `gradle tasks` |
| `dbt docs generate / serve` | ドキュメントサイト生成・表示 | Javadoc |
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

`dbt run` で `2 of 2 OK` になれば完成です。`dbt run --select stg_shop__customers` とすると、このモデルだけを実行できます。

</details>

**2-2.** `dbt_project.yml` の `+materialized: view` を `table` に変えて `dbt run` し、`target/run/` の SQL がどう変わるか確認してください。確認できたら `view` に戻します。

<details><summary>解答</summary>

`create view ... as (...)` が `create table ... as (...)` に変わります。
**SELECT 文は1文字も変えずに、実体化の方法だけを設定で切り替えられる** のがポイントです。第10章で詳しく扱います。

</details>

**2-3.** 設定ファイルにわざと間違いを入れて（例: `profile: my_cofee_shop` とタイプミス）、`dbt debug` がどんなエラーを出すか確認してください。

## つまずきポイント

- **`Could not find profile named 'xxx'`** … `dbt_project.yml` の `profile:` と、`profiles.yml` の一番上のキーが一致していません。
- **`IO Error: Could not set lock on file`** … DuckDB は、書き込みできるプロセスが1つだけです。DBeaver などの GUI で同じファイルを開いていると、dbt から書き込めません。GUI 側の接続を閉じてください。
- **SQL の末尾にセミコロンを書いてエラー** … dbt はモデルを `create view ... as (<あなたのSQL>)` のように包みます。末尾の `;` は書かないでください。
- **`raw.orders` が無いと言われる** … `load_raw.py` の `--db` で、自分の DuckDB ファイルを指定してロードしたか確認してください。

## まとめ

- `dbt_project.yml` は **何を** ビルドするか、`profiles.yml` は **どこに** 接続するか
- モデルは SELECT 文1つ。ファイル名がテーブル名になり、DDL は dbt が生成する
- `target/compiled/` と `target/run/` を見れば、dbt が実際に投げた SQL が分かる

⬅️ 前章: [第1章](01-what-is-dbt.md) ／ ➡️ 次章: [第3章 model・ref・source・seed](03-models-ref-source.md)
