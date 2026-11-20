{#
  文字列の正規化: 前後の空白を除去し小文字に揃える。
  TS でいう const cleanString = (s: string) => s.trim().toLowerCase() のような小さなユーティリティ。
  マクロは「SQL 文字列を返す関数」であり、実行時ではなくコンパイル時に展開される点に注意。
#}
{% macro clean_string(column_name) -%}
    lower(trim({{ column_name }}))
{%- endmacro %}
