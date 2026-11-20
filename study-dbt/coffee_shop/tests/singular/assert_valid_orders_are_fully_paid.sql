-- singular test: 1ファイル = 1テストの、そのプロジェクト固有のアサーション。
-- 「有効な注文は、注文合計と同額が決済されている」という業務ルールを検証する。
-- 返した行が「違反」。0 行なら成功。

select
    order_id,
    order_status,
    order_total_jpy,
    paid_amount_jpy
from {{ ref('fct_orders') }}
where
    is_valid_order
    and order_total_jpy <> paid_amount_jpy
