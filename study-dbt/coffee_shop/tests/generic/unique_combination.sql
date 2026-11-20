{#
  複数列の組み合わせが一意であることを検証するモデルレベルの generic test。
  （dbt_utils.unique_combination_of_columns の簡易版）
#}
{% test unique_combination(model, columns) %}

select
    {{ columns | join(', ') }},
    count(*) as n
from {{ model }}
group by {{ columns | join(', ') }}
having count(*) > 1

{% endtest %}
