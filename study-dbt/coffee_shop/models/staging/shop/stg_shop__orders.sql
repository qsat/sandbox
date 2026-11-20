with source as (

    select * from {{ source('shop', 'orders') }}

),

renamed as (

    select
        id                           as order_id,
        user_id                      as customer_id,   -- アプリ側の命名(user)を分析側の命名(customer)へ
        order_date                   as ordered_on,
        {{ clean_string('status') }} as order_status,  -- 'COMPLETED' / 'completed ' などの表記ゆれを吸収
        shipping_fee                 as shipping_fee_jpy,
        created_at                   as ordered_at,
        updated_at

    from source

)

select * from renamed
