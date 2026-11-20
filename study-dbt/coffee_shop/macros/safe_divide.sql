{# ゼロ除算で NULL を返す割り算。Java なら (d == 0) ? null : n / d #}
{% macro safe_divide(numerator, denominator) -%}
    ({{ numerator }}) / nullif({{ denominator }}, 0)
{%- endmacro %}
