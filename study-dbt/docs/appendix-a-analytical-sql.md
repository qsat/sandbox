# 補講A アプリエンジニアのための分析 SQL

> **この補講のゴール**
> - 「1行ずつ処理する」発想から「集合をまとめて変換する」発想に切り替える
> - CTE、JOIN による行の増殖（fan-out）、集約、ウィンドウ関数、NULL の扱いを使いこなす
>
> アプリ開発で書く SQL は「ID で1件取る」「1件更新する」が中心です。
> 分析 SQL は **数百万行をまとめて変換・集約する** ので、使う道具と、はまる落とし穴が違います。
> dbt を書き始める前、または第4章を読んだあとに、この補講で練習してください。

## A.1 たとえ: SQL は Stream API / 配列メソッドチェーン

```java
// Java Stream
orders.stream()
    .filter(o -> o.status().equals("completed"))              // WHERE
    .collect(groupingBy(Order::customerId,                    // GROUP BY
             summingLong(Order::totalJpy)));                  // SUM()
```

```ts
// TypeScript
Object.entries(Object.groupBy(
  orders.filter(o => o.status === 'completed'),               // WHERE
  o => o.customerId,                                          // GROUP BY
)).map(([id, os]) => ({ id, total: sum(os!.map(o => o.totalJpy)) }))  // SUM()
```

```sql
-- SQL
select customer_id, sum(order_total_jpy)
from fct_orders
where order_status = 'completed'
group by customer_id
```

SQL は **for ループを書かない、宣言的なコレクション操作** です。
「どう処理するか」ではなく「どんな結果が欲しいか」を書き、実行計画は DB が決めます。
Stream / 配列メソッドに慣れていれば、発想はそのまま通用します。

| SQL | Java Stream | TS Array |
|---|---|---|
| `where` | `filter` | `filter` |
| `select 式` | `map` | `map` |
| `group by` + 集約 | `collect(groupingBy(...))` | `Object.groupBy` + `reduce` |
| `join` | `flatMap`（ネストループ） | `flatMap` |
| `order by` | `sorted` | `toSorted` |
| `limit` | `limit` | `slice` |
| `distinct` | `distinct` | `[...new Set()]` |
| ウィンドウ関数 | （標準にない。自前で書く） | （同左） |

以降の例は、完成版 `coffee_shop/` で `make build` 済みとして、`coffee_shop/` ディレクトリで実行できます。

```bash
dbt show --inline "<SQL>" --limit 20
```

## A.2 CTE（with 句）: SQL の変数宣言

```sql
with completed_orders as (           -- const completedOrders = orders.filter(...)
    select * from {{ ref('fct_orders') }}
    where order_status = 'completed'
),

per_customer as (                    -- const perCustomer = groupBy(completedOrders, ...)
    select customer_id, count(*) as n, sum(order_total_jpy) as total
    from completed_orders
    group by customer_id
)

select * from per_customer order by total desc
```

CTE は「**名前付きの中間結果**」で、TS の `const` 宣言のように使えます。
サブクエリを入れ子にするより上から下へ読めるので、dbt では **ほぼすべてのモデルを CTE で書く** のが慣習です。

## A.3 JOIN と行の増殖（fan-out）⚠️ 最重要

アプリエンジニアが分析 SQL で **最もはまる罠** です。

### 問題

「送料の合計」を求めます。ついでに決済情報も JOIN したとします。

```sql
-- ❌ 間違い
select sum(o.shipping_fee_jpy)
from {{ ref('stg_shop__orders') }} as o
inner join {{ ref('stg_shop__payments') }} as p
    on o.order_id = p.order_id
```

| | 行数 | 送料合計 |
|---|---|---|
| 注文だけ | 1,342 | **547,250 円** |
| 注文 × 決済 | 1,501 | **615,450 円** ← 約 7 万円多い！ |

1つの注文に決済が複数ある（失敗→再決済、ギフトカード併用）と、**注文の行がその数だけ複製** されます。
そのため送料が二重・三重に足されてしまいます。

```text
orders                payments                  JOIN 結果
order_id fee          order_id method           order_id fee  method
1        550    ×     1        gift_card   →    1        550  gift_card
                      1        credit_card      1        550  credit_card   ← 550 が 2 回
```

Java でたとえるなら、`orders.stream().flatMap(o -> paymentsOf(o).stream().map(p -> o))` のあとで送料を合計しているのと同じです。

### 対策: 「粒度をそろえてから JOIN」

```sql
-- ✅ 正しい: 決済を「1行 = 1注文」に集約してから JOIN する
with payments_per_order as (
    select order_id, sum(amount_jpy) as paid_amount_jpy
    from {{ ref('stg_shop__payments') }}
    where payment_status = 'success'
    group by order_id
)

select sum(o.shipping_fee_jpy), sum(p.paid_amount_jpy)
from {{ ref('stg_shop__orders') }} as o
left join payments_per_order as p
    on o.order_id = p.order_id
```

完成版の `int_payments__pivoted_to_orders` が、まさにこの「1行 = 1注文に集約する」部品です。
**各テーブル・各 CTE の「1行が何を表すか（粒度）」を常に意識する** ことが、第4章のディメンショナルモデリングにつながります。

> 💡 **fan-out を検出する習慣**
> JOIN の前後で `count(*)` と `count(distinct 主キー)` を比べる癖をつけましょう。dbt なら、モデルの主キーに `unique` テストを付けておけば自動で検出できます（第6章）。

### JOIN の種類

| JOIN | 意味 | 使いどころ |
|---|---|---|
| `inner join` | 両方に存在する行だけ | 必ず存在する親子関係 |
| `left join` | 左はすべて残す（右が無ければ NULL） | **分析では基本これ**。「注文の無い顧客」も残したいとき |
| `full outer join` | 両方すべて残す | 2つのデータの突き合わせ（差分検出） |
| `cross join` | 全組み合わせ | 日付 × 店舗のような「枠」を作るとき |

## A.4 集約: GROUP BY と条件付き集計

```sql
select
    date_trunc('month', ordered_on)                         as month,
    count(*)                                                as all_orders,
    count(*) filter (where order_status = 'completed')      as completed_orders,
    sum(case when order_status = 'cancelled' then 1 else 0 end) as cancelled_orders,
    count(distinct customer_id)                             as customers
from {{ ref('stg_shop__orders') }}
group by 1
order by 1
```

- `filter (where ...)` と `sum(case when ... then 1 else 0 end)` は同じ意味です（`filter` は DuckDB / PostgreSQL / Snowflake などで使えます）
- `group by 1` は「select の1列目でグループ化」という意味の省略記法です
- `having` は「集約 **後** の where」です（例: `having count(*) >= 5`）

## A.5 ウィンドウ関数: 行を減らさずに集計する

GROUP BY は行を **畳み込みます**。ウィンドウ関数は、行を **残したまま** 「同じグループの他の行」を参照できます。

```text
GROUP BY:        10 行 → 3 行（顧客ごとに1行）
ウィンドウ関数:  10 行 → 10 行（各行に「その顧客の何回目の注文か」などを付与）
```

Java で書くと、`groupingBy` したあとで各グループをソートし、元の要素にインデックスや前要素を付け直す処理に相当します。
SQL ならこれが1行で書けます。

```sql
select
    customer_id,
    order_id,
    ordered_on,
    row_number() over (partition by customer_id order by ordered_at)     as order_number,
    lag(ordered_on) over (partition by customer_id order by ordered_at) as previous_ordered_on,
    ordered_on - lag(ordered_on) over (partition by customer_id order by ordered_at)
                                                                         as days_since_previous,
    sum(order_total_jpy) over (partition by customer_id order by ordered_at
                               rows between unbounded preceding and current row)
                                                                         as running_total_jpy
from {{ ref('fct_orders') }}
where customer_id = 5
```

| 構文 | 意味 |
|---|---|
| `partition by` | グループ（`groupingBy` のキー）。省略すると全体で1グループ |
| `order by` | グループ内の並び順 |
| `row_number()` | 連番（1, 2, 3...） |
| `rank()` / `dense_rank()` | 同順位ありの順位 |
| `lag(x)` / `lead(x)` | 前の行 / 次の行の値 |
| `first_value(x)` / `last_value(x)` | 先頭 / 末尾の値 |
| `sum(x) over (...)` | 累計・移動合計 |

### 定番パターン: グループごとに最新の1行を取る

```sql
select *
from {{ ref('fct_orders') }}
qualify row_number() over (partition by customer_id order by ordered_at desc) = 1
```

`qualify` はウィンドウ関数の結果で絞り込む構文です（DuckDB / Snowflake / BigQuery / Databricks で使えます）。
使えない DB では、サブクエリで `row_number()` を計算してから `where rn = 1` で絞ります。

## A.6 NULL: 三値論理の罠

SQL の NULL は「値が無い」ではなく「**不明**」です。比較の結果も `true / false / unknown` の3値になります。

| 式 | 結果 | TS / Java の感覚 |
|---|---|---|
| `null = null` | **unknown**（≒ false 扱い） | `null === null` は true なので注意 |
| `null <> 'x'` | **unknown** | |
| `1 + null` | **null** | Java なら NullPointerException |
| `count(*)` | NULL の行も数える | |
| `count(col)` | NULL の行は **数えない** | |
| `sum(col)` / `avg(col)` | NULL を **無視** する | |

### よくある事故

```sql
-- 「completed 以外の注文」を数えたいが…
select count(*) from orders where order_status <> 'completed'
-- order_status が NULL の行は「unknown」になり、結果に含まれない！

-- ✅ NULL も含めたいなら明示する
where order_status <> 'completed' or order_status is null
-- ✅ または、DuckDB / PostgreSQL などなら
where order_status is distinct from 'completed'
```

```sql
-- LEFT JOIN で注文が無い顧客の LTV は NULL になる
select customers.customer_id, sum(orders.order_total_jpy) as ltv   -- 注文 0 件の顧客は NULL
-- ✅ 0 にしたいなら coalesce
coalesce(sum(orders.order_total_jpy), 0) as ltv
```

完成版の `dim_customers` では `coalesce(customer_orders.lifetime_order_count, 0)` のように、NULL を意図した値に置き換えています。

> 💡 **TS の `??` は SQL の `coalesce`**
> `x ?? 0` は `coalesce(x, 0)`、`a?.b` に近いのが `left join` です（相手がいなければ NULL）。

## A.7 日付・時刻

```sql
date_trunc('month', ordered_on)        -- 月初に切り捨て（月次集計の定番）
ordered_on - interval 7 day            -- 7日前
date_diff('day', first_ordered_on, last_ordered_on)  -- 日数差
extract(dow from ordered_on)           -- 曜日（0 = 日曜）
cast(ordered_at as date)               -- timestamp → date
```

> ⚠️ 日付関数は **DB ごとに方言が大きい** 部分です（BigQuery は `DATE_TRUNC(d, MONTH)`、Snowflake は `DATEADD` など）。
> dbt では、こうした差を吸収するクロスDBマクロ（`dbt.date_trunc()` など）が用意されています（第9章）。

## 演習

すべて `coffee_shop/` で `dbt show --inline "..."` を使って実行してください。

**A-1.** 焙煎度（`roast_level`）ごとの販売数量と売上を求めてください（`fct_order_lines` と `dim_products` を使う）。

<details><summary>解答</summary>

```sql
select p.roast_level, sum(l.quantity) as qty, sum(l.line_amount_jpy) as revenue
from {{ ref('fct_order_lines') }} as l
inner join {{ ref('dim_products') }} as p on l.product_id = p.product_id
where l.order_status = 'completed'
group by 1
order by revenue desc
```

`fct_order_lines` は「1行 = 1明細」、`dim_products` は「1行 = 1商品」なので、明細側から見て相手は高々1行です。fan-out は起きません。

</details>

**A-2.** 各顧客の「2回目の注文日」を求めてください。2回目の注文が無い顧客は含めなくてかまいません。

<details><summary>解答</summary>

```sql
select customer_id, ordered_on as second_ordered_on
from {{ ref('fct_orders') }}
where is_valid_order
qualify row_number() over (partition by customer_id order by ordered_at) = 2
```

</details>

**A-3.** 次の SQL は「顧客ごとの注文数と決済回数」を出そうとしていますが、注文数が多すぎます。原因を説明し、修正してください。

```sql
select o.customer_id, count(*) as orders, count(p.payment_id) as payments
from {{ ref('stg_shop__orders') }} o
left join {{ ref('stg_shop__payments') }} p on o.order_id = p.order_id
group by 1
```

<details><summary>解答</summary>

決済が複数ある注文の行が複製され（fan-out）、`count(*)` が決済の行数を数えてしまっています。
修正方法は2つあります。

```sql
-- 修正1: distinct で数える（手軽だが、sum には使えない）
count(distinct o.order_id) as orders

-- 修正2: 先に粒度をそろえる（推奨）
with payments_per_order as (
    select order_id, count(*) as payment_count
    from {{ ref('stg_shop__payments') }} group by 1
)
select o.customer_id, count(*) as orders, coalesce(sum(p.payment_count), 0) as payments
from {{ ref('stg_shop__orders') }} o
left join payments_per_order p on o.order_id = p.order_id
group by 1
```

</details>

**A-4.** `dim_customers` で `first_ordered_on` が NULL の顧客は何人いますか？ また、それはなぜ NULL なのでしょうか？

<details><summary>解答</summary>

59人です（day1 時点）。有効な注文が1件も無い顧客（見込み客 = `prospect`）は、`left join` した `customer_orders` に相手の行が無いため NULL になります。

</details>

## まとめ

- SQL は宣言的なコレクション操作。Stream / 配列メソッドの感覚で読み書きできる
- **JOIN の前に粒度をそろえる。** fan-out は最も多いバグ
- ウィンドウ関数は「行を減らさない集計」。最新1件、n回目、前回との差、累計に使う
- NULL は三値論理。`<>` で NULL が落ちる、`count(col)` は NULL を数えない、`coalesce` で既定値

⬅️ 戻る: [第3章](03-models-ref-source.md) ／ ➡️ 次章: [第4章 分析のためのドメインモデリング](04-dimensional-modeling.md)
