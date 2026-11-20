{#
  dbt 組み込みマクロ generate_schema_name の上書き（Java でいう @Override）。

  デフォルト挙動: <target.schema>_<custom_schema>   例) dev_staging, prod_staging
  このプロジェクトの挙動:
    - prod target  : custom_schema をそのまま使う   例) staging, marts
    - それ以外(dev): <target.schema>_<custom_schema> 例) dev_staging, dev_marts
  → 本番のスキーマ名をきれいに保ちつつ、開発者はサンドボックスで安全に作業できる。
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- set default_schema = target.schema -%}
    {%- if custom_schema_name is none -%}
        {{ default_schema }}
    {%- elif target.name == 'prod' -%}
        {{ custom_schema_name | trim }}
    {%- else -%}
        {{ default_schema }}_{{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
