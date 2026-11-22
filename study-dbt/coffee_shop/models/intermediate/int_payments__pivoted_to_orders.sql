-- 決済を注文単位に縦→横変換（pivot）する。
-- 決済手段の一覧は macro payment_methods() から取り、Jinja の for ループで列を生成する。
-- 粒度(grain): 1行 = 1注文（成功した決済が1件以上ある注文のみ）

with payments as (

    select * from {{ ref('stg_shop__payments') }}
    where payment_status = 'success'

),

pivoted as (

    select
        order_id,

        {% for method in payment_methods() -%}
            sum(case when payment_method = '{{ method }}' then amount_jpy else 0 end)::bigint
                as {{ method }}_amount_jpy,
        {% endfor -%}

        sum(amount_jpy)::bigint                                                               as paid_amount_jpy

    from payments
    group by order_id

)

select * from pivoted
