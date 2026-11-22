-- 経理・経営向けの月次売上。BI ダッシュボード（exposure: monthly_sales_dashboard）が参照する。
-- 粒度(grain): 1行 = 1か月 × 1地方
-- 売上の定義: 完了(completed)した注文の合計金額（送料込み）。返品・キャンセルは含まない。

with orders as (

    select * from {{ ref('fct_orders') }}
    where order_status = 'completed'

),

customers as (

    select
        customer_id,
        region
    from {{ ref('dim_customers') }}

),

final as (

    select
        date_trunc('month', orders.ordered_on)::date                           as revenue_month,
        customers.region,
        count(*)                                                               as order_count,
        count(distinct orders.customer_id)                                     as customer_count,
        sum(orders.order_total_jpy)::bigint                                    as revenue_jpy,
        round({{ safe_divide('sum(orders.order_total_jpy)', 'count(*)') }}, 0)
            as average_order_value_jpy

    from orders
    left join customers
        on orders.customer_id = customers.customer_id
    group by 1, 2

)

select * from final
