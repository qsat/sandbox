-- intermediate モデルの責務: staging を組み合わせて、marts を作るための「部品」を作る。
-- 利用者（BI やアナリスト）には公開しない内部実装。Java でいう package-private なクラス。
-- 粒度(grain): 1行 = 1注文明細

with order_items as (

    select * from {{ ref('stg_shop__order_items') }}

),

products as (

    select * from {{ ref('stg_shop__products') }}

),

joined as (

    select
        order_items.order_item_id,
        order_items.order_id,
        order_items.product_id,
        products.product_name,
        products.origin_country,
        products.roast_level,
        order_items.quantity,
        order_items.unit_price_jpy,
        order_items.quantity * order_items.unit_price_jpy as line_amount_jpy

    from order_items
    left join products
        on order_items.product_id = products.product_id

)

select * from joined
