{#
  自作の汎用（generic）テスト。YAML から `- positive_value` として任意の列に適用できる。
  dbt のデータテストは「違反行を返す SELECT」。0 行なら成功、1 行以上なら失敗。
  JUnit の assertTrue(x > 0) を、全行に対して一括で実行するイメージ。
#}
{% test positive_value(model, column_name) %}

select {{ column_name }}
from {{ model }}
where {{ column_name }} <= 0

{% endtest %}
