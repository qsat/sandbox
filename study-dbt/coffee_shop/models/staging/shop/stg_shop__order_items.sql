with source as (

    select * from {{ source('shop', 'order_items') }}

),

renamed as (

    select
        id         as order_item_id,
        order_id,
        product_id,
        quantity,
        unit_price as unit_price_jpy

    from source

)

select * from renamed
