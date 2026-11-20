{#
  決済手段の一覧。複数のモデルで同じリストを使うため、マクロに切り出して一元管理する
  （Java の enum PaymentMethod { CREDIT_CARD, ... } に相当）。
#}
{% macro payment_methods() -%}
    {{ return(['credit_card', 'konbini', 'bank_transfer', 'gift_card']) }}
{%- endmacro %}
