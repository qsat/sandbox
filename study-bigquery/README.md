# study-bigquery — Athena 経験者のための BigQuery 入門

BigQuery を、**TypeScript / Java のアプリ開発経験があり、AWS Athena を少し触ったことがある** 中級プログラマ向けに学ぶ教材です。

- 前提知識: SQL の基本（SELECT / JOIN / GROUP BY）、Athena で S3 上のデータにクエリを投げたことがある程度
- 環境: **BigQuery sandbox**（クレジットカード不要・無料枠内）＋ 公開データセット
- 題材: Google が公開している架空のアパレル EC データ **`bigquery-public-data.thelook_ecommerce`**
- スタイル: 各章で BigQuery の概念を **Athena と TS / Java の知っている概念にたとえて** から手を動かす

> 🚧 **ステータス: 第1〜3章まで執筆済み（ドラフト）**。第4章以降は章立てのみです。内容は調整前提です。

## ゴール（逆算の起点）

> BigQuery の仕組み（ストレージとコンピュートの分離、列指向、スロット）を Athena と対比して説明でき、
> **コストを見積もってから** クエリを書き、パーティション・クラスタ・ネスト構造を使ったテーブルを設計できる。
> さらに、TS / Java アプリや dbt から安全に使える。

| マイルストーン（逆順） | 到達状態 | 章 |
|---|---|---|
| 5 | 本番運用（権限・監視・コスト管理）を設計できる | 11–14 |
| 4 | アプリ（TS / Java）や dbt から BigQuery を使える | 9–10 |
| 3 | コストと性能をコントロールできる | 7–8 |
| 2 | パーティション・クラスタ・ネストでテーブルを設計できる | 4–6 |
| 1 | BigQuery の全体像を説明でき、コストを確認しながらクエリを書ける | **1–3** ✅ |

## 章立て

参考にした書籍・資料（下記「参考資料」）の構成を、**Athena との差分** と **アプリエンジニア目線** で並べ替えています。

| # | 章 | 状態 | ひとことで | Athena / TS・Java でいうと |
|---|---|---|---|---|
| | **Part I — 基礎** | | | |
| 1 | [BigQuery の全体像](docs/01-overview.md) | ✅ | サーバーレスな列指向 DWH | Athena + S3 + Glue を 1 つにしたもの |
| 2 | [環境構築とはじめてのクエリ](docs/02-first-query.md) | ✅ | sandbox・コンソール・bq CLI・コスト確認 | Athena コンソール / `aws athena` CLI |
| 3 | [GoogleSQL 入門（Athena との差分）](docs/03-googlesql.md) | ✅ | STRUCT / ARRAY / UNNEST / QUALIFY | Trino SQL の方言差、record / List |
| | **Part II — ストレージ設計** | | | |
| 4 | パーティショニングとクラスタリング | 📝 | スキャン量を減らす2大機能 | Hive パーティション / partition projection |
| 5 | データの取り込み | 📝 | ロード・外部テーブル・BigLake・Storage Write API | S3 に置く / Glue Crawler / Firehose |
| 6 | ネストと非正規化のモデリング | 📝 | ARRAY<STRUCT> で JOIN を減らす | 集約をそのまま JSON で持つ |
| | **Part III — コストと性能** | | | |
| 7 | 料金モデルとコスト管理 | 📝 | オンデマンド vs Editions（スロット） | スキャン課金 vs プロビジョニング |
| 8 | クエリ最適化と実行計画 | 📝 | ステージ・シャッフル・スロット時間 | `EXPLAIN ANALYZE` / プロファイラ |
| | **Part IV — 連携** | | | |
| 9 | TypeScript / Java から使う | 📝 | クライアントライブラリ・パラメータ化クエリ | AWS SDK の Athena クライアント |
| 10 | 変換パイプライン | 📝 | スケジュールクエリ・Dataform・dbt | Glue ジョブ / Step Functions |
| 11 | セキュリティとガバナンス | 📝 | IAM・行/列レベルセキュリティ・承認済みビュー | IAM + Lake Formation |
| | **Part V — 発展** | | | |
| 12 | BigQuery ML と AI 関数 | 📝 | SQL で機械学習・生成 AI | SageMaker を SQL から |
| 13 | 運用と監視 | 📝 | INFORMATION_SCHEMA・監査ログ・クォータ | CloudTrail / CloudWatch |
| 14 | 総仕上げ | 📝 | thelook の分析基盤を設計して作る | — |

各章は **ゴール → アナロジー → 解説 → ハンズオン → 演習（解答つき） → つまずきポイント → まとめ** の順に構成しています。
dbt は姉妹教材 [`../study-dbt`](../study-dbt/README.md) で扱っています（第10章で接続する予定）。

## Athena → BigQuery 早見表

| Athena / AWS | BigQuery / Google Cloud | 章 |
|---|---|---|
| AWS アカウント | プロジェクト（課金・権限の単位） | 1 |
| Glue Data Catalog のデータベース | データセット | 1 |
| S3 上のファイル + Glue テーブル定義 | テーブル（BigQuery 管理のストレージ） | 1 |
| Glue テーブル（S3 を直接参照） | 外部テーブル / BigLake テーブル | 5 |
| Trino（Presto）エンジン | Dremel エンジン | 1 |
| スキャン量課金（$5 / TB） | オンデマンド課金（$6.25 / TiB、毎月 1 TiB 無料） | 1, 7 |
| ワークグループのデータ使用量制限 | 最大課金バイト数 / カスタムクォータ | 2, 7 |
| クエリ結果は S3 に出力 | 結果は一時テーブル（24時間キャッシュ） | 2 |
| Hive 形式のパーティション（`dt=2025-01-01/`） | 列ベースのパーティション + クラスタリング | 4 |
| `CROSS JOIN UNNEST` / `ROW` 型 | `UNNEST` / `STRUCT` 型 | 3 |
| `try_cast` / `try()` | `SAFE_CAST` / `SAFE.` 接頭辞 | 3 |
| Iceberg テーブルでの DML | 通常のテーブルで DML（INSERT / UPDATE / DELETE / MERGE） | 5 |
| Lake Formation | IAM + 行/列レベルセキュリティ + ポリシータグ | 11 |

## セットアップ

[第2章](docs/02-first-query.md) を参照してください。要点は次のとおりです。

1. Google アカウントで [Google Cloud コンソール](https://console.cloud.google.com/bigquery) を開き、プロジェクトを作る
2. 課金を有効にしなければ、自動的に **BigQuery sandbox**（無料・カード不要）として使える
3. 公開データセット `bigquery-public-data.thelook_ecommerce` にクエリする

## 参考資料

| 種類 | 資料 | 取り入れた点 |
|---|---|---|
| 書籍（日本語） | 『BigQueryではじめるSQLデータ分析』（インプレス, 2024） | SQL の段階的な学び方、分析クエリの題材 |
| 書籍（日本語） | 『改訂新版 Google Cloudではじめる実践データエンジニアリング入門』（技術評論社, 2025） | データ基盤全体の中での BigQuery の位置づけ、取り込み・運用 |
| 書籍（英語） | *Google BigQuery: The Definitive Guide*（O'Reilly, 2019） | アーキテクチャ、性能・コストの章立て |
| 書籍（英語） | *Data Exploration and Preparation with BigQuery*（Packt, 2023） | 公開データセットを使ったハンズオン |
| 公式 | [BigQuery ドキュメント](https://cloud.google.com/bigquery/docs) / [料金](https://cloud.google.com/bigquery/pricing) / [sandbox](https://cloud.google.com/bigquery/docs/sandbox) | 数値・仕様の確認 |

> ⚠️ 料金や無料枠、sandbox の制限は変わることがあります。本文の数値は 2026年11月時点の公式ページに基づきます。実際に使う前に公式ページで確認してください。
> 本文の SQL は BigQuery 方言のパーサで構文チェック済みですが、執筆環境から BigQuery に接続して実行はしていません。動かない例があれば直します。
