"""data/raw/<day>/*.csv を DuckDB の raw スキーマへロードする「なんちゃって EL ツール」。

dbt は ELT の T（Transform）だけを担当する。E（Extract）と L（Load）は
Fivetran / Airbyte / 自前バッチなどの別ツールの仕事であり、この教材ではこのスクリプトがその役を演じる。

使い方 (study-dbt/ ディレクトリで実行):
    python scripts/load_raw.py --day day1
    python scripts/load_raw.py --day day2 --db coffee_shop/coffee_shop.duckdb

挙動:
  - raw スキーマの各テーブルを CSV の内容で「全件置き換え」する（フル同期型 EL を想定）
  - 各行に _loaded_at（ロード時刻）列を付与する。dbt の source freshness がこの列を見る
"""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
TABLES = ["customers", "products", "orders", "order_items", "payments"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--day", default="day1", choices=["day1", "day2"])
    parser.add_argument("--db", default=str(ROOT / "coffee_shop" / "coffee_shop.duckdb"),
                        help="ロード先 DuckDB ファイル（dbt の profiles.yml の path と合わせる）")
    args = parser.parse_args()

    src = ROOT / "data" / "raw" / args.day
    con = duckdb.connect(args.db)
    con.execute("create schema if not exists raw")
    for t in TABLES:
        csv_path = (src / f"{t}.csv").as_posix()
        con.execute(f"""
            create or replace table raw.{t} as
            select *, current_timestamp as _loaded_at
            from read_csv('{csv_path}', header = true)
        """)
        n = con.execute(f"select count(*) from raw.{t}").fetchone()[0]
        print(f"raw.{t:<12} <- {args.day}/{t}.csv  ({n} rows)")
    con.close()


if __name__ == "__main__":
    main()
