{% docs customer_segment %}

注文回数による顧客セグメント。マーケティング施策の出し分けに使う。

| 値 | 条件（有効な注文数） | 想定する施策 |
|---|---|---|
| `prospect` | 0 回 | 初回購入クーポン |
| `new` | 1 回 | 2回目購入の後押し（レビュー依頼・おすすめ） |
| `repeat` | 2 回 〜 `loyal_customer_min_orders` − 1 回 | 定期便の案内 |
| `loyal` | `loyal_customer_min_orders` 回以上（既定 5 回） | 限定ロットの先行案内 |

キャンセルされた注文は数えない（`fct_orders.is_valid_order = false`）。

{% enddocs %}

{% docs order_status %}

注文ステータス。業務アプリでは次のように遷移する。

```
placed（注文受付） → shipped（出荷済み） → completed（配達完了）
                  ↘ cancelled（キャンセル）          ↘ returned（返品）
```

売上として計上するのは `completed` のみ（`fct_monthly_revenue` を参照）。

{% enddocs %}
