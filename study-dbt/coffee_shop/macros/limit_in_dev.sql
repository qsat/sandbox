{#
  開発環境でだけ行数を絞る。大きなテーブルを dev で毎回フルビルドしないための定番テクニック。
  使い方: select ... from ... {{ limit_in_dev(100) }}
#}
{% macro limit_in_dev(n=1000) -%}
    {%- if target.name == 'dev' -%}
        limit {{ n }}
    {%- endif -%}
{%- endmacro %}
