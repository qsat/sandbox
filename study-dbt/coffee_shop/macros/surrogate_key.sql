{#
  複数列から決定的なサロゲートキー（ハッシュ）を作る。
  dbt_utils.generate_surrogate_key と同じ発想の簡易版（教材はオフラインで動くよう自前実装）。
  NULL を '_null_' に置き換えてから連結するので、(1, NULL) と (NULL, 1) が衝突しない。
#}
{% macro surrogate_key(columns) -%}
    md5(concat_ws('|'
    {%- for col in columns %},
        coalesce(cast({{ col }} as varchar), '_null_')
    {%- endfor %}
    ))
{%- endmacro %}
