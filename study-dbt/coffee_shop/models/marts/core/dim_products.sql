-- ディメンションテーブル: 商品という「モノ（エンティティ）」の属性。
-- 粒度(grain): 1行 = 1商品（現在の状態）。価格の履歴は snapshot（snap_products）が持つ。

select
    product_id,
    product_name,
    origin_country,
    roast_level,
    is_blend,
    price_jpy as current_price_jpy,
    is_active

from {{ ref('stg_shop__products') }}
