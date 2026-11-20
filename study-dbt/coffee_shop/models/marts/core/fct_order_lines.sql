-- ファクトテーブル: 注文明細。商品別・産地別の分析に使う。
-- 粒度(grain): 1行 = 1注文明細

with order_lines as (

    select * from {{ ref('int_order_lines__joined_products') }}

),

orders as (

    select * from {{ ref('stg_shop__orders') }}

),

final as (

    select
        order_lines.order_item_id as order_line_id,
        order_lines.order_id,
        orders.customer_id,
        order_lines.product_id,
        orders.ordered_on,
        orders.order_status,
        order_lines.quantity,
        order_lines.unit_price_jpy,
        order_lines.line_amount_jpy

    from order_lines
    inner join orders
        on order_lines.order_id = orders.order_id

)

select * from final
