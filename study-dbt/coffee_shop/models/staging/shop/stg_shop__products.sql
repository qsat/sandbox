with source as (

    select * from {{ source('shop', 'products') }}

),

renamed as (

    select
        id                       as product_id,
        name                     as product_name,
        origin_country,
        -- 業務アプリの短縮コードを、分析で読める値に変換する
        case roast_level
            when 'L' then 'light'
            when 'LM' then 'medium_light'
            when 'M' then 'medium'
            when 'MD' then 'medium_dark'
            when 'D' then 'dark'
        end                      as roast_level,
        origin_country = 'Blend' as is_blend,
        price                    as price_jpy,
        is_active,
        updated_at

    from source

)

select * from renamed
