-- ファクトテーブル: 注文という「出来事（ドメインイベント）」の記録。
-- 粒度(grain): 1行 = 1注文
--
-- materialized='incremental': 2回目以降は「前回ビルド以降に更新された注文」だけを処理し、
-- unique_key が一致する行は置き換える（delete+insert）。メモ化された差分ビルドのイメージ。

{{
    config(
        materialized='incremental',
        unique_key='order_id',
        incremental_strategy='delete+insert',
        on_schema_change='append_new_columns'
    )
}}

with orders as (

    select * from {{ ref('stg_shop__orders') }}

    {% if is_incremental() %}
        -- {{ this }} は「このモデル自身の既存テーブル」を指す
        where updated_at > (
            select coalesce(max(this_model.updated_at), '1900-01-01')
            from {{ this }} as this_model
        )
    {% endif %}

),

order_lines as (

    select * from {{ ref('int_order_lines__joined_products') }}

),

payments as (

    select * from {{ ref('int_payments__pivoted_to_orders') }}

),

order_line_summary as (

    select
        order_id,
        count(*)                     as line_count,
        sum(quantity)::bigint        as item_quantity,
        sum(line_amount_jpy)::bigint as items_subtotal_jpy

    from order_lines
    group by order_id

),

final as (

    select
        orders.order_id,
        orders.customer_id,
        orders.ordered_on,
        orders.ordered_at,
        orders.order_status,
        orders.order_status in ('placed', 'shipped', 'completed', 'returned') as is_valid_order,
        order_line_summary.line_count,
        order_line_summary.item_quantity,
        order_line_summary.items_subtotal_jpy,
        orders.shipping_fee_jpy,
        order_line_summary.items_subtotal_jpy + orders.shipping_fee_jpy       as order_total_jpy,

        {% for method in payment_methods() -%}
            coalesce(payments.{{ method }}_amount_jpy, 0) as {{ method }}_amount_jpy, -- noqa: LT01
        {% endfor -%}
        coalesce(payments.paid_amount_jpy, 0)                                 as paid_amount_jpy,

        orders.updated_at

    from orders
    left join order_line_summary
        on orders.order_id = order_line_summary.order_id
    left join payments
        on orders.order_id = payments.order_id

)

select * from final
