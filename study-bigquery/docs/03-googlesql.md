# 第3章 GoogleSQL 入門 — Athena（Trino）との差分

> **この章のゴール**
> - Athena（Trino）の SQL と BigQuery の GoogleSQL の違いを知り、つまずかずに書き換えられる
> - BigQuery の型（特に日時型）を、Java / TS の型に対応づけて理解する
> - `STRUCT` と `ARRAY`、`UNNEST` / `ARRAY_AGG` で、ネストしたデータを自在に扱える
> - `QUALIFY`、`SAFE.` 接頭辞、`SELECT * EXCEPT` などの BigQuery らしい書き方を使える
>
> この章の例の多くは、`WITH` 句の中にデータを直接書いています。**テーブルを読まないので、処理バイト数は 0 で無料** です。気兼ねなく試してください。

## 3.1 たとえ: 同じ SQL でも「方言」が違う

Athena の SQL（Trino）と BigQuery の SQL（GoogleSQL）は、どちらも ANSI SQL がベースです。`SELECT` / `JOIN` / `GROUP BY` / ウィンドウ関数は、ほとんどそのまま通じます。
違いが出るのは、**識別子の書き方、型の名前、日付関数、エラー処理、ネストしたデータの扱い** です。

TS と Java がどちらも C 系の構文なのに、標準ライブラリの API 名が違うのと似ています。

## 3.2 方言の早見表

| やりたいこと | Athena（Trino） | BigQuery（GoogleSQL） |
|---|---|---|
| 識別子のクオート | `"my-column"` | `` `my-column` `` |
| 文字列リテラル | `'abc'` のみ | `'abc'` または `"abc"` |
| 整数型 / 小数型 | `bigint` / `double` | `INT64` / `FLOAT64` |
| 文字列型 | `varchar` | `STRING` |
| 構造体型 | `row(a integer, b varchar)` | `STRUCT<a INT64, b STRING>` |
| 配列型 | `array(integer)` | `ARRAY<INT64>` |
| キャスト失敗時に NULL | `try_cast(x as integer)` | `SAFE_CAST(x AS INT64)` |
| エラー時に NULL（関数） | `try(f(x))` | `SAFE.f(x)` |
| 月初に切り捨て | `date_trunc('month', d)` | `DATE_TRUNC(d, MONTH)` ← **引数の順序が逆** |
| 日数の差 | `date_diff('day', d1, d2)` | `DATE_DIFF(d2, d1, DAY)` ← **順序が違う** |
| 日付の加算 | `date_add('day', 7, d)` | `DATE_ADD(d, INTERVAL 7 DAY)` |
| 日付の書式化 | `date_format(d, '%Y-%m')` | `FORMAT_DATE('%Y-%m', d)` |
| 条件付きカウント | `count_if(cond)` | `COUNTIF(cond)` |
| 条件分岐 | `if(cond, a, b)` | `IF(cond, a, b)` |
| 配列の展開 | `CROSS JOIN UNNEST(arr) AS t(x)` | `CROSS JOIN UNNEST(arr) AS x`（`, UNNEST(arr) AS x` とも書ける） |
| 配列への集約 | `array_agg(x)` | `ARRAY_AGG(x)` |
| ウィンドウ関数の結果で絞る | サブクエリ + `where rn = 1` | **`QUALIFY rn = 1`** |
| 特定の列以外をすべて選択 | （無い） | **`SELECT * EXCEPT (col)`** |
| 近似の distinct 数 | `approx_distinct(x)` | `APPROX_COUNT_DISTINCT(x)` |

日付関数の引数の順序は、最もよく間違えるところです。BigQuery は「**対象の値が先、単位が後**」と覚えましょう。

## 3.3 型: Java / TS との対応

| GoogleSQL | Java | TypeScript | メモ |
|---|---|---|---|
| `INT64` | `long` | `bigint`（`number` だと 2^53 を超えると精度が落ちる） | 整数型はこれ1つだけ |
| `FLOAT64` | `double` | `number` | 金額には使わない |
| `NUMERIC` / `BIGNUMERIC` | `BigDecimal` | （ライブラリ） | **金額はこれ** |
| `BOOL` | `boolean` | `boolean` | |
| `STRING` | `String` | `string` | UTF-8 |
| `BYTES` | `byte[]` | `Uint8Array` | |
| `DATE` | `LocalDate` | — | 年月日だけ |
| `DATETIME` | `LocalDateTime` | — | **タイムゾーンなし** の日時 |
| `TIMESTAMP` | `Instant` | `Date` | **絶対時刻**（内部は UTC） |
| `TIME` | `LocalTime` | — | |
| `STRUCT<...>` | `record` | オブジェクト型 `{ a: number }` | 3.5 節 |
| `ARRAY<T>` | `List<T>` | `T[]` | 3.5 節。NULL を要素に持てない |
| `JSON` | `JsonNode`（Jackson） | `unknown`（パース前） | |
| `GEOGRAPHY` | （JTS の Geometry） | GeoJSON | 地理空間 |

### TIMESTAMP と DATETIME の違い ⚠️

Java の `Instant` と `LocalDateTime` の違いを知っていれば、すぐに分かります。

```sql
select
  timestamp '2026-01-01 00:00:00+09'                        as ts,          -- 絶対時刻（UTC 2025-12-31 15:00）
  datetime(timestamp '2026-01-01 00:00:00+09', 'Asia/Tokyo') as jst_dt,      -- 東京の壁時計: 2026-01-01 00:00
  date(timestamp '2026-01-01 00:00:00+09')                  as date_utc,    -- UTC の日付: 2025-12-31 ⚠️
  date(timestamp '2026-01-01 00:00:00+09', 'Asia/Tokyo')    as date_jst     -- 東京の日付: 2026-01-01
```

`DATE(timestamp)` は、タイムゾーンを指定しないと **UTC で日付を切り出します**。
日本の業務データで日次集計するときは、必ず `'Asia/Tokyo'` を指定しましょう。午前0〜9時の注文が前日に計上される、というバグの定番です。

## 3.4 BigQuery らしい便利な書き方

### `SELECT * EXCEPT` / `REPLACE`

```sql
select * except (email, street_address)          -- 個人情報の列を除いてすべて
from `bigquery-public-data.thelook_ecommerce.users`
limit 10
```

```sql
select * replace (lower(email) as email)        -- 一部の列だけを加工して、全列を返す
from `bigquery-public-data.thelook_ecommerce.users`
limit 10
```

> ⚠️ `EXCEPT` で列を除いても、**残りの列はすべて読みます**。料金を下げたいなら、必要な列を明示的に書きます。

### `QUALIFY`: ウィンドウ関数の結果で絞る

「会員ごとの最新の注文」を取る定番パターンです。Athena ではサブクエリが必要でした。

```sql
select order_id, user_id, status, created_at
from `bigquery-public-data.thelook_ecommerce.orders`
where true            -- QUALIFY と一緒に where / group by / having のいずれかを書く慣習（下記参照）
qualify row_number() over (partition by user_id order by created_at desc) = 1
```

### `SAFE.` 接頭辞と `SAFE_CAST`: 例外を投げずに NULL を返す

```sql
with raw as (
  select '123' as v union all
  select 'abc' union all
  select '2026-02-30'
)
select
  v,
  safe_cast(v as int64)          as as_int,     -- 'abc' → NULL（エラーにしない）
  safe.parse_date('%Y-%m-%d', v) as as_date,    -- '2026-02-30' → NULL
  safe_divide(10, 0)             as div_zero    -- 0 除算 → NULL
from raw
```

Java でいえば、`Integer.parseInt` を `try-catch` で囲んで、失敗したら `null` を返すユーティリティです。
汚れた生データを扱う staging 層（[dbt 教材の第5章](../../study-dbt/docs/05-layers.md)）でよく使います。

### `COUNTIF` と `IF`

```sql
select
  date_trunc(date(created_at, 'Asia/Tokyo'), month) as order_month,
  count(*)                                          as orders,
  countif(status = 'Returned')                      as returned,
  round(safe_divide(countif(status = 'Returned'), count(*)) * 100, 1) as return_rate_pct
from `bigquery-public-data.thelook_ecommerce.orders`
group by order_month
order by order_month
```

## 3.5 STRUCT と ARRAY: ネストしたデータ

BigQuery の大きな特徴が、**1つのセルに構造体や配列を入れられる** ことです。
JSON のようなネスト構造を、型付きのままテーブルに持てます。

| GoogleSQL | TypeScript | Java |
|---|---|---|
| `STRUCT<name STRING, price NUMERIC>` | `{ name: string; price: number }` | `record Item(String name, BigDecimal price)` |
| `ARRAY<INT64>` | `number[]` | `List<Long>` |
| `ARRAY<STRUCT<...>>` | `Item[]` | `List<Item>` |
| `UNNEST(arr)` | `arr.flatMap(...)`（配列を行に展開） | `list.stream().flatMap(...)` |
| `ARRAY_AGG(x)` | `group` して `map` で配列化 | `collect(groupingBy(..., mapping(..., toList())))` |

Athena でも `ROW` 型と `ARRAY` 型、`CROSS JOIN UNNEST` を使ったことがあるかもしれません。考え方は同じです。

### STRUCT を作って使う

```sql
with users as (
  select 1 as user_id, struct('Tokyo' as city, '100-0001' as postal_code) as address
)

select
  user_id,
  address,               -- STRUCT のまま
  address.city           -- フィールドには . でアクセス
from users
```

結果のスキーマでは、`address` が `RECORD` 型（STRUCT の別名）として表示されます。

### ARRAY を行に展開する: UNNEST

注文が「明細の配列」を持っている、というデータを `WITH` 句で作ってみます。

```sql
with orders as (
  select 1 as order_id, [
    struct('T-shirt' as name, 2 as qty, 1500 as price),
    struct('Cap'     as name, 1 as qty, 2000 as price)
  ] as items
  union all
  select 2, [struct('Jeans' as name, 1 as qty, 8000 as price)]
  union all
  select 3, cast([] as array<struct<name string, qty int64, price int64>>)   -- 明細が空の注文
)

select
  o.order_id,
  item.name,
  item.qty * item.price as line_amount
from orders as o
cross join unnest(o.items) as item
```

| order_id | name | line_amount |
|---|---|---|
| 1 | T-shirt | 3000 |
| 1 | Cap | 2000 |
| 2 | Jeans | 8000 |

`UNNEST` は、TS の `orders.flatMap(o => o.items.map(item => ({ orderId: o.id, ...item })))` と同じです。

注文3が消えていることに注目してください。`CROSS JOIN` は、**配列が空の行を落とします**（`flatMap` で空配列が何も生まないのと同じ）。
空でも行を残したいときは、`LEFT JOIN UNNEST(...) ON TRUE` を使います。

```sql
-- 上の WITH 句の続き
select o.order_id, item.name
from orders as o
left join unnest(o.items) as item on true   -- 注文3も name = NULL で残る
```

### 行を配列にまとめる: ARRAY_AGG

逆方向です。thelook の `order_items`（1行 = 1明細）を、「1行 = 1注文、明細は配列」の形にまとめます。

```sql
select
  order_id,
  any_value(user_id) as user_id,
  array_agg(
    struct(product_id, sale_price, status)
    order by id
  ) as items,
  sum(sale_price) as order_total
from `bigquery-public-data.thelook_ecommerce.order_items`
group by order_id
limit 10
```

結果をコンソールで見ると、1つの注文の行の中に、明細が入れ子で表示されます。
これは、**DDD の集約（Order が OrderItem のリストを持つ）を、そのままテーブルの1行で表現した** 形です。

> 💡 **なぜネストさせるのか**（第6章で詳しく扱います）
> 注文と明細を別テーブルにして JOIN するかわりに、明細を配列として注文の中に持たせると、JOIN（＝シャッフル）が不要になり、高速かつ安くなります。
> Google Analytics 4 のエクスポートデータも、「1行 = 1イベント、パラメータは配列」というネスト構造です。

### 配列の中だけで集計する: 相関サブクエリ

配列を展開せずに、**各行の配列の中だけ** で計算することもできます。

```sql
with orders as (
  select 1 as order_id, [
    struct('T-shirt' as name, 2 as qty, 1500 as price),
    struct('Cap'     as name, 1 as qty, 2000 as price)
  ] as items
)

select
  order_id,
  (select sum(i.qty * i.price) from unnest(items) as i) as order_total,
  (select count(*) from unnest(items) as i where i.price >= 2000) as expensive_items,
  array(select i.name from unnest(items) as i order by i.name) as item_names
from orders
```

TS でいえば `order.items.reduce(...)` や `order.items.filter(...).map(...)` を、行ごとに実行しているイメージです。
**行数が増えない（fan-out しない）** のが利点です。

## 3.6 スクリプトと一時関数

### 変数とスクリプト

```sql
declare target_month date default date '2025-06-01';

select count(*) as orders
from `bigquery-public-data.thelook_ecommerce.orders`
where date_trunc(date(created_at, 'Asia/Tokyo'), month) = target_month;
```

複数の文をセミコロンで区切って、1つのジョブとして実行できます（**マルチステートメントクエリ**）。
`IF` / `LOOP` / `BEGIN ... EXCEPTION` などの制御構文もあり、簡単なバッチ処理なら SQL だけで書けます。

### 一時関数（UDF）: SQL でも JavaScript でも

```sql
create temp function to_tax_excluded(price numeric)
returns numeric
as (round(price / numeric '1.10', 0));

create temp function normalize_email(email string)
returns string
language js
as r"""
  return email ? email.trim().toLowerCase() : null;
""";

select
  to_tax_excluded(numeric '1100') as excluded,
  normalize_email('  Foo@Example.COM ') as email;
```

**JavaScript UDF** が書けるのは、TS エンジニアにはうれしい機能です。SQL では書きにくい文字列処理などに使えます。
ただし、SQL の UDF より遅いので、SQL で書けるものは SQL で書きましょう。

`create temp function` はそのクエリの中だけで有効です。チームで共有したい関数は、`create function study.normalize_email(...)` のようにデータセットに保存します（永続 UDF）。

## 演習

**3-1.** 次の Athena のクエリを GoogleSQL に書き換えてください。

```sql
-- Athena (Trino)
select
  date_trunc('month', created_at) as month,
  count_if(status = 'Cancelled') as cancelled,
  date_diff('day', min(created_at), max(created_at)) as span_days
from "thelook"."orders"
group by 1
```

<details><summary>解答</summary>

```sql
select
  timestamp_trunc(created_at, month) as month,
  countif(status = 'Cancelled') as cancelled,
  timestamp_diff(max(created_at), min(created_at), day) as span_days
from `bigquery-public-data.thelook_ecommerce.orders`
group by 1
```

`created_at` は `TIMESTAMP` 型なので、`DATE_TRUNC` / `DATE_DIFF` ではなく **`TIMESTAMP_TRUNC` / `TIMESTAMP_DIFF`** を使います。
BigQuery は型ごとに関数が分かれています（`DATE_*`、`DATETIME_*`、`TIMESTAMP_*`）。
日本時間の月で集計したいなら、`date_trunc(date(created_at, 'Asia/Tokyo'), month)` と書きます。

</details>

**3-2.** thelook の `order_items` から、**会員ごとに、購入した商品 ID の配列（重複なし）と、購入合計金額** を求めてください。

<details><summary>解答</summary>

```sql
select
  user_id,
  array_agg(distinct product_id order by product_id) as product_ids,
  round(sum(sale_price), 2) as total_spent
from `bigquery-public-data.thelook_ecommerce.order_items`
where status not in ('Cancelled', 'Returned')
group by user_id
order by total_spent desc
limit 20
```

</details>

**3-3.** 3.5 節の「明細の配列を持つ注文」の `WITH` 句を使って、**明細が2つ以上ある注文だけ** を、展開せずに抽出してください。

<details><summary>解答</summary>

```sql
-- 3.5 節の with orders as (...) に続けて
select order_id, items
from orders
where array_length(items) >= 2
```

`ARRAY_LENGTH` で、配列の要素数を数えられます。TS の `items.length >= 2` と同じです。
`UNNEST` しないので、行の重複も起きません。

</details>

**3-4.** 次のクエリには、日本の業務で使うときの問題があります。指摘して修正してください。

```sql
select date(created_at) as order_date, count(*) as orders
from `bigquery-public-data.thelook_ecommerce.orders`
group by order_date
```

<details><summary>解答</summary>

`DATE(created_at)` は、UTC で日付を切り出します。日本時間の午前0時〜9時の注文が、前日として集計されます。

```sql
select date(created_at, 'Asia/Tokyo') as order_date, count(*) as orders
from `bigquery-public-data.thelook_ecommerce.orders`
group by order_date
```

（thelook は世界中の会員を含む架空データなので、本来は会員の国に合わせるべきですが、ここでは「日本の業務なら」という前提です。）

</details>

**3-5.**（考察）ネスト（`ARRAY<STRUCT>`）で持つのと、別テーブルにして JOIN するのとでは、どんなトレードオフがあるでしょうか？ DDD の集約の考え方と関連づけて考えてください。

<details><summary>解答例</summary>

- **ネスト**: 集約（注文と明細）を1行にまとめるので、JOIN が不要で高速・安価になる。一方、明細だけを横断的に分析する（商品別の売上など）には、毎回 `UNNEST` が必要になる。明細だけを更新するのも面倒になる
- **別テーブル**: 粒度ごとに独立して扱えるので、どの切り口の分析にも素直に対応できる。ただし、JOIN のコストがかかる

DDD でいえば「集約の境界でまとめる」のがネストです。読み取りのパターンが「注文単位」中心ならネスト、「明細を横断」中心なら別テーブル、と使い分けます。第6章で詳しく扱います。

</details>

## つまずきポイント

- **日付関数の引数の順序** … `DATE_TRUNC(d, MONTH)`、`DATE_DIFF(後, 前, DAY)`。Trino とは順序が逆です。
- **`TIMESTAMP` に `DATE_*` 関数を使ってエラー** … 型ごとに `DATE_*` / `DATETIME_*` / `TIMESTAMP_*` を使い分けます。
- **`DATE(timestamp)` が UTC で切られる** … タイムゾーンを必ず指定します。
- **`CROSS JOIN UNNEST` で行が消える** … 空配列の行は落ちます。残すなら `LEFT JOIN UNNEST(...) ON TRUE` です。
- **`UNNEST` の後に `SUM` して金額が膨らむ** … 配列を展開すると、親の列（送料など）が要素の数だけ複製されます（fan-out）。親の値の集計は、展開前に行いましょう。
- **`QUALIFY` だけを書いてエラー** … かつては `WHERE`、`GROUP BY`、`HAVING` のいずれかが無いとエラーになりました。どの環境でも通るよう、`WHERE TRUE` を付ける書き方がよく使われます。

## まとめ

- GoogleSQL は Trino とおおむね同じ。差が出るのは、**識別子のクオート、型名、日付関数の引数の順序、エラー処理（`SAFE.`）**
- 日時は `TIMESTAMP`（= `Instant`）と `DATETIME`（= `LocalDateTime`）を区別し、日付への変換ではタイムゾーンを指定する
- `STRUCT` は record、`ARRAY` は List。`UNNEST` は flatMap、`ARRAY_AGG` は collect
- `QUALIFY`、`SELECT * EXCEPT`、`COUNTIF`、一時関数（JS も可）で、クエリを短く書ける

⬅️ 前章: [第2章](02-first-query.md) ／ ➡️ 次章: 第4章 パーティショニングとクラスタリング（未執筆）
