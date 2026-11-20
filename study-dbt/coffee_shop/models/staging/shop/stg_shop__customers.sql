-- staging モデルの責務: 1 source テーブル = 1 モデル。
--   列名の統一 / 型変換 / 表記ゆれの正規化 だけを行い、JOIN や集計はしない。
-- アプリ設計でいう「腐敗防止層（Anti-Corruption Layer）」。外部の都合をここで吸収する。

with source as (

    select * from {{ source('shop', 'customers') }}

),

renamed as (

    select
        id                          as customer_id,
        name                        as customer_name,
        {{ clean_string('email') }} as email,
        trim(prefecture)            as prefecture,
        created_at,
        updated_at

    from source

)

select * from renamed
