"""架空のコーヒー豆EC「Bean Voyage」の生データ(CSV)を生成するスクリプト。

本物のシステムでは、これらのCSVは業務アプリのDBから EL ツール（Fivetran / Airbyte 等）が
DWH に同期してくるデータに相当する。教材では day1 / day2 の2時点を用意し、
day2 では「注文ステータスの更新」「新規注文」「顧客の住所変更」「商品の値上げ」が起きる。

使い方:
    python scripts/generate_data.py          # data/raw/day1, data/raw/day2 を作り直す

乱数シードは固定なので、何度実行しても同じCSVが出力される。
"""

from __future__ import annotations

import csv
import random
from dataclasses import dataclass, asdict, replace
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data" / "raw"
rng = random.Random(20260101)

PREFECTURES = [
    "北海道", "青森県", "宮城県", "東京都", "神奈川県", "埼玉県", "千葉県", "茨城県",
    "新潟県", "長野県", "静岡県", "愛知県", "岐阜県", "京都府", "大阪府", "兵庫県",
    "奈良県", "広島県", "岡山県", "香川県", "愛媛県", "福岡県", "熊本県", "沖縄県",
]
PREF_WEIGHTS = [4, 1, 2, 18, 9, 7, 6, 2, 2, 2, 3, 8, 1, 3, 9, 5, 1, 2, 1, 1, 1, 5, 1, 1]

FIRST = ["蓮", "陽翔", "湊", "結菜", "葵", "陽葵", "凛", "大和", "芽依", "悠真", "咲良", "颯"]
LAST = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤"]

PRODUCTS = [
    # name, origin, roast(raw code), price
    ("エチオピア イルガチェフェ", "Ethiopia", "L", 1980),
    ("エチオピア グジ ナチュラル", "Ethiopia", "L", 2280),
    ("ケニア ニエリ AA", "Kenya", "LM", 2380),
    ("コロンビア ウイラ", "Colombia", "M", 1680),
    ("コロンビア デカフェ", "Colombia", "M", 1880),
    ("グアテマラ アンティグア", "Guatemala", "M", 1780),
    ("ブラジル セラード", "Brazil", "MD", 1480),
    ("ブラジル 完熟ナチュラル", "Brazil", "MD", 1580),
    ("コスタリカ ハニー", "Costa Rica", "LM", 2080),
    ("パナマ ゲイシャ", "Panama", "L", 4980),
    ("インドネシア マンデリン", "Indonesia", "D", 1780),
    ("ハウスブレンド", "Blend", "MD", 1380),
    ("エスプレッソブレンド", "Blend", "D", 1480),
    ("モーニングブレンド", "Blend", "M", 1380),
    ("ルワンダ ブルボン", "Rwanda", "LM", 2180),
    ("ペルー オーガニック", "Peru", "M", 1680),
]

PAYMENT_METHODS = ["credit_card", "credit_card", "credit_card", "konbini", "bank_transfer", "gift_card"]


@dataclass
class Customer:
    id: int
    name: str
    email: str
    prefecture: str
    created_at: str
    updated_at: str


@dataclass
class Product:
    id: int
    name: str
    origin_country: str
    roast_level: str
    price: int
    is_active: bool
    updated_at: str


@dataclass
class Order:
    id: int
    user_id: int
    order_date: str
    status: str
    shipping_fee: int
    created_at: str
    updated_at: str


@dataclass
class OrderItem:
    id: int
    order_id: int
    product_id: int
    quantity: int
    unit_price: int


@dataclass
class Payment:
    id: int
    order_id: int
    payment_method: str
    status: str
    amount: int
    created_at: str


def ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def messy_email(name_id: int) -> str:
    """生データらしく、大文字混じり・前後空白入りのメールアドレスを時々作る。"""
    email = f"user{name_id:04d}@example.com"
    r = rng.random()
    if r < 0.08:
        return email.upper()
    if r < 0.14:
        return f" {email} "
    return email


def messy_status(status: str) -> str:
    """業務アプリ側の表記ゆれ（大文字・前後空白）を再現する。"""
    r = rng.random()
    if r < 0.05:
        return status.upper()
    if r < 0.08:
        return f"{status} "
    return status


def build_day1():
    start = datetime(2025, 1, 1)
    customers: list[Customer] = []
    for cid in range(1, 301):
        created = start + timedelta(days=rng.randint(-400, 300)) + timedelta(seconds=rng.randint(0, 86399))
        customers.append(Customer(
            id=cid,
            name=f"{rng.choice(LAST)} {rng.choice(FIRST)}",
            email=messy_email(cid),
            prefecture=rng.choices(PREFECTURES, PREF_WEIGHTS)[0],
            created_at=ts(created),
            updated_at=ts(created),
        ))

    products = [
        Product(i + 1, n, o, r, p, True, ts(datetime(2024, 10, 1, 9)))
        for i, (n, o, r, p) in enumerate(PRODUCTS)
    ]
    products[4] = replace(products[4], is_active=False)  # デカフェは販売終了

    orders: list[Order] = []
    items: list[OrderItem] = []
    payments: list[Payment] = []

    # 顧客ごとの購買頻度にばらつきを持たせる（ロングテール）
    weights = [rng.paretovariate(1.3) for _ in customers]
    # 約1割は購入実績ゼロ（見込み客）
    for i in rng.sample(range(len(customers)), 30):
        weights[i] = 0

    oid = iid = pid = 0
    day = datetime(2025, 1, 1)
    end = datetime(2025, 12, 31)
    while day <= end:
        n_orders = rng.randint(2, 7) + (3 if day.month == 12 else 0)
        for _ in range(n_orders):
            cust = rng.choices(customers, weights)[0]
            ordered_at = day + timedelta(seconds=rng.randint(0, 86399))
            if ordered_at < datetime.strptime(cust.created_at, "%Y-%m-%d %H:%M:%S"):
                continue
            oid += 1
            n_lines = rng.choices([1, 2, 3], [60, 30, 10])[0]
            subtotal = 0
            for prod in rng.sample([p for p in products if p.is_active or ordered_at < datetime(2025, 6, 1)], n_lines):
                iid += 1
                qty = rng.choices([1, 2, 3], [70, 25, 5])[0]
                items.append(OrderItem(iid, oid, prod.id, qty, prod.price))
                subtotal += qty * prod.price
            shipping = 0 if subtotal >= 5000 else 550

            age_days = (end - ordered_at).days
            if age_days < 2:
                status = "placed"
            elif age_days < 5:
                status = "shipped"
            else:
                status = rng.choices(["completed", "returned", "cancelled"], [90, 4, 6])[0]

            updated = ordered_at + timedelta(days=min(age_days, rng.randint(2, 6)))
            orders.append(Order(oid, cust.id, ordered_at.strftime("%Y-%m-%d"), messy_status(status),
                                shipping, ts(ordered_at), ts(updated)))

            # 支払い: キャンセルは失敗決済のみ / 一部の注文は 1回失敗してから成功
            method = rng.choice(PAYMENT_METHODS)
            if status == "cancelled":
                pid += 1
                payments.append(Payment(pid, oid, method, "failed", subtotal + shipping, ts(ordered_at)))
                continue
            if rng.random() < 0.05:
                pid += 1
                payments.append(Payment(pid, oid, "credit_card", "failed", subtotal + shipping, ts(ordered_at)))
            total = subtotal + shipping
            # 1割はギフトカード＋クレカの併用払い
            if method == "gift_card" and total > 1000 and rng.random() < 0.5:
                gift = 1000
                pid += 1
                payments.append(Payment(pid, oid, "gift_card", "success", gift, ts(ordered_at)))
                pid += 1
                payments.append(Payment(pid, oid, "credit_card", "success", total - gift, ts(ordered_at)))
            else:
                pid += 1
                payments.append(Payment(pid, oid, method, "success", total, ts(ordered_at)))
        day += timedelta(days=1)

    return customers, products, orders, items, payments


def build_day2(customers, products, orders, items, payments):
    """day1 の翌々週 (2026-01-14) 時点の状態を作る。"""
    customers = [replace(c) for c in customers]
    products = [replace(p) for p in products]
    orders = [replace(o) for o in orders]
    items = list(items)
    payments = list(payments)
    now = datetime(2026, 1, 14, 6, 0)

    # 1) 引っ越した顧客（SCD Type 2 スナップショットの題材）
    for c in rng.sample(customers, 12):
        c.prefecture = rng.choice([p for p in PREFECTURES if p != c.prefecture])
        c.updated_at = ts(datetime(2026, 1, rng.randint(2, 13), rng.randint(8, 22)))

    # 2) 値上げ（check 戦略スナップショットの題材）
    for p in products:
        if p.origin_country in ("Ethiopia", "Kenya", "Panama"):
            p.price = int(round(p.price * 1.1, -1))
            p.updated_at = ts(datetime(2026, 1, 5, 9))

    # 3) day1 時点で placed / shipped だった注文が completed に進む（incremental の題材）
    for o in orders:
        if o.status.strip().lower() in ("placed", "shipped"):
            o.status = "completed"
            o.updated_at = ts(datetime(2026, 1, rng.randint(3, 6), rng.randint(8, 20)))

    # 4) 新規注文 (2026-01-01〜01-13)
    oid = max(o.id for o in orders)
    iid = max(i.id for i in items)
    pid = max(p.id for p in payments)
    buyers = rng.sample(customers, 60)
    day = datetime(2026, 1, 1)
    while day < datetime(2026, 1, 14):
        for _ in range(rng.randint(3, 8)):
            cust = rng.choice(buyers)
            ordered_at = day + timedelta(seconds=rng.randint(0, 86399))
            oid += 1
            subtotal = 0
            for prod in rng.sample([p for p in products if p.is_active], rng.choice([1, 1, 2])):
                iid += 1
                qty = rng.choice([1, 1, 2])
                items.append(OrderItem(iid, oid, prod.id, qty, prod.price))
                subtotal += qty * prod.price
            shipping = 0 if subtotal >= 5000 else 550
            age = (now - ordered_at).days
            status = "placed" if age < 2 else "shipped" if age < 5 else "completed"
            orders.append(Order(oid, cust.id, ordered_at.strftime("%Y-%m-%d"), status, shipping,
                                ts(ordered_at), ts(ordered_at + timedelta(days=min(age, 3)))))
            pid += 1
            payments.append(Payment(pid, oid, rng.choice(PAYMENT_METHODS[:5]), "success",
                                    subtotal + shipping, ts(ordered_at)))
        day += timedelta(days=1)

    return customers, products, orders, items, payments


def write(day: str, customers, products, orders, items, payments) -> None:
    out = ROOT / day
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in [("customers", customers), ("products", products), ("orders", orders),
                       ("order_items", items), ("payments", payments)]:
        with open(out / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
            dicts = [asdict(r) for r in rows]
            w = csv.DictWriter(f, fieldnames=list(dicts[0].keys()))
            w.writeheader()
            w.writerows(dicts)
        print(f"  {day}/{name}.csv: {len(rows)} rows")


if __name__ == "__main__":
    d1 = build_day1()
    write("day1", *d1)
    d2 = build_day2(*d1)
    write("day2", *d2)
