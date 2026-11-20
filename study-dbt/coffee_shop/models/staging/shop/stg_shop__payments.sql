with source as (

    select * from {{ source('shop', 'payments') }}

),

renamed as (

    select
        id                                   as payment_id,
        order_id,
        {{ clean_string('payment_method') }} as payment_method,
        {{ clean_string('status') }}         as payment_status,
        amount                               as amount_jpy,
        created_at                           as paid_at

    from source

)

select * from renamed
