-- analyses/ は「dbt run では実行されないが、ref() などの Jinja が使える SQL」置き場。
-- dbt compile すると target/compiled/ に実行可能な SQL が出力されるので、それを手で実行する。
-- 用途: アドホック分析、移行時の検証クエリなど。

with customers as (

    select * from {{ ref('dim_customers') }}
    where first_ordered_on is not null

)

select
    date_trunc('month', first_ordered_on)::date                                    as cohort_month,
    count(*)                                                                       as customers,
    count(*) filter (where lifetime_order_count >= 2)                              as repeat_customers,
    round(100.0 * count(*) filter (where lifetime_order_count >= 2) / count(*), 1) as repeat_rate_pct
from customers
group by 1
order by 1
