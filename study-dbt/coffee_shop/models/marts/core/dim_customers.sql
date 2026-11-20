-- ディメンションテーブル: 会員という「ヒト（エンティティ）」の属性 + 購買サマリ。
-- 粒度(grain): 1行 = 1会員（購入実績ゼロの会員も含む）

with customers as (

    select * from {{ ref('stg_shop__customers') }}

),

regions as (

    select * from {{ ref('prefecture_regions') }}

),

orders as (

    select * from {{ ref('fct_orders') }}
    where is_valid_order

),

customer_orders as (

    select
        customer_id,
        min(ordered_on)              as first_ordered_on,
        max(ordered_on)              as last_ordered_on,
        count(*)                     as lifetime_order_count,
        sum(order_total_jpy)::bigint as lifetime_value_jpy

    from orders
    group by customer_id

),

final as (

    select
        customers.customer_id,
        customers.customer_name,
        customers.email,
        customers.prefecture,
        regions.region,
        customers.created_at                              as registered_at,
        customer_orders.first_ordered_on,
        customer_orders.last_ordered_on,
        coalesce(customer_orders.lifetime_order_count, 0) as lifetime_order_count,
        coalesce(customer_orders.lifetime_value_jpy, 0)   as lifetime_value_jpy,

        -- 顧客セグメント（ビジネスルール。unit test で仕様を固定している）
        case
            when coalesce(customer_orders.lifetime_order_count, 0) = 0 then 'prospect'
            when customer_orders.lifetime_order_count = 1 then 'new'
            when customer_orders.lifetime_order_count >= {{ var('loyal_customer_min_orders') }} then 'loyal'
            else 'repeat'
        end                                               as customer_segment

    from customers
    left join regions
        on customers.prefecture = regions.prefecture
    left join customer_orders
        on customers.customer_id = customer_orders.customer_id

)

select * from final
