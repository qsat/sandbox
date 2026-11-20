# 第2章 環境構築とはじめてのクエリ

> **この章のゴール**
> - BigQuery sandbox で、無料・カード不要の学習環境を用意する
> - コンソールと `bq` CLI の両方からクエリを実行できる
> - **クエリを実行する前に、読み込むバイト数（＝料金）を確認する** 習慣をつける
> - 自分のデータセットを作り、CTAS でテーブルを作れる

## 2.1 たとえ: Athena の操作との対応

| やりたいこと | Athena | BigQuery |
|---|---|---|
| ブラウザでクエリ | Athena コンソールのクエリエディタ | BigQuery Studio（コンソール）のクエリエディタ |
| CLI でクエリ | `aws athena start-query-execution` → 結果を取得（非同期） | `bq query`（完了まで待って結果を表示） |
| 実行前にコストを知る | （基本的にできない。実行後に "Data scanned" を見る） | **ドライラン**（エディタ右上に「このクエリを実行すると X MB が処理されます」と出る） |
| テーブルの中身をちょっと見る | `select * ... limit 10`（スキャン課金あり） | **プレビュー**（無料）／`bq head` |
| スキャン量に上限を設ける | ワークグループの制限 | 最大課金バイト数（クエリごと）／カスタムクォータ（1日あたり） |
| 認証 | IAM ユーザー / `aws configure` | Google アカウント / `gcloud auth login` |

## 2.2 BigQuery sandbox を用意する

**BigQuery sandbox** は、課金アカウント（クレジットカード）を登録せずに BigQuery を使える仕組みです。

| sandbox の制限（2026年11月時点） | 内容 |
|---|---|
| 無料枠 | ストレージ 10 GB、クエリ 1 TB / 月（通常の無料枠と同じ） |
| テーブルの有効期限 | データセットの既定の有効期限が **60日**。テーブル・ビュー・パーティションは60日で自動削除される |
| 使えない機能 | DML（INSERT / UPDATE / DELETE / MERGE）、ストリーミング挿入、Data Transfer Service など |

学習の第1〜4章程度なら、sandbox で十分です。DML が必要になったら（第5章以降）、課金を有効にして無料枠の範囲で使います。

### 手順

> コンソールの画面構成はよく変わります。ボタン名が違っていたら、近いものを探してください。

1. Google アカウントでログインし、[BigQuery コンソール](https://console.cloud.google.com/bigquery) を開く
2. 画面の指示に従って **新しいプロジェクトを作成** する（例: `study-bq-<あなたの名前>`）
   - **プロジェクト ID** は世界で一意の ID で、あとから変更できません。以降のコマンドで使うのでメモしておきます
3. 課金を設定していなければ、画面上部に **sandbox** であることを示す表示が出る

### 公開データセットを見えるようにする

左側の **エクスプローラ** で、`bigquery-public-data` プロジェクトを追加（スター）します。
検索欄に `thelook_ecommerce` と入力すると、データセットが見つかります。

この教材の題材 **`bigquery-public-data.thelook_ecommerce`** は、Google が公開している架空のアパレル EC のデータです。

| テーブル | 中身 | 主キー |
|---|---|---|
| `users` | 会員（年齢・性別・国・流入元など） | `id` |
| `products` | 商品（カテゴリ・ブランド・原価・定価） | `id` |
| `orders` | 注文ヘッダ（ステータス・注文日時・出荷日時など） | `order_id` |
| `order_items` | 注文明細（販売価格など） | `id` |
| `inventory_items` | 在庫品 | `id` |
| `distribution_centers` | 物流センター | `id` |
| `events` | Web サイトの行動ログ | `id` |

> 📝 このデータセットは定期的に再生成されるため、件数や日付は実行するたびに変わります。本文では具体的な件数を書いていません。

## 2.3 はじめてのクエリ（コンソール）

クエリエディタに次の SQL を入力します。**まだ実行しないでください。**

```sql
select
  status,
  count(*) as order_count
from `bigquery-public-data.thelook_ecommerce.orders`
group by status
order by order_count desc
```

エディタの右上（または下部）に、次のような表示が出ているはずです。

> ✅ このクエリを実行すると、XX MB が処理されます。

これが **ドライラン**（dry run）の結果です。BigQuery は、SQL を解析した時点で「どのテーブルのどの列を読むか」が分かるので、**実行前に** 読み込むバイト数を計算できます。
オンデマンド料金は、この値でほぼ決まります。

> 💡 **習慣にすること**: クエリを実行する前に、毎回この表示を見る。
> Athena では実行してから "Data scanned" を見ていたと思いますが、BigQuery では **見てから実行** できます。

確認したら実行します。結果の下にある **ジョブ情報**（Job information）タブで、次の項目を確認してください。

| 項目 | 意味 |
|---|---|
| 処理されたバイト数（Bytes processed） | 実際に読んだ量 |
| 課金されたバイト数（Bytes billed） | 課金対象の量（テーブルごとの最低 10 MB などを反映） |
| 経過時間・スロット時間 | 実時間と、使った計算資源の合計（第8章） |

### キャッシュ

同じクエリをもう一度実行してみてください。ジョブ情報に **キャッシュ済み（cached）** と表示され、処理バイト数は **0 B** になります。

BigQuery は、クエリ結果を約24時間キャッシュします。参照するテーブルが変わっていなければ、同じクエリは無料で即座に返ります。
アプリ開発でいえば、**参照先が更新されたら自動で破棄される、メモ化されたキャッシュ** です。

次の場合は、キャッシュが使われません。

- `current_timestamp()` や `rand()` のような、実行のたびに結果が変わる関数を使っている
- 参照しているテーブルが更新された
- 結果の宛先テーブルを指定している

## 2.4 料金の感覚をつかむ実験

同じ `orders` テーブルに対して、次の4つのクエリの **ドライラン結果（処理されるバイト数）** を、実行せずに記録してください。

```sql
-- ① 全列
select * from `bigquery-public-data.thelook_ecommerce.orders`
```

```sql
-- ② 全列 + LIMIT
select * from `bigquery-public-data.thelook_ecommerce.orders` limit 10
```

```sql
-- ③ 1列だけ
select status from `bigquery-public-data.thelook_ecommerce.orders`
```

```sql
-- ④ 1列 + WHERE（別の列で絞り込み）
select status
from `bigquery-public-data.thelook_ecommerce.orders`
where created_at >= timestamp '2025-01-01'
```

| クエリ | 処理されるバイト数（自分で記入） |
|---|---|
| ① `select *` | |
| ② `select * ... limit 10` | |
| ③ `select status` | |
| ④ `select status ... where created_at ...` | |

第1章の「列指向」の説明どおり、次のようになるはずです。

- ① と ② は **同じ**（`LIMIT` では読む量は減らない）
- ③ は ① よりずっと小さい（1列分だけ）
- ④ は ③ より **大きい**（`where` で使った `created_at` 列も読むため）。行は絞っているのに、料金は増える

> 💡 中身をちょっと見たいだけなら、`select * ... limit 10` ではなく、テーブルの **プレビュー** タブ（または `bq head`）を使いましょう。プレビューは無料です。

## 2.5 bq CLI を使う

コンソールで十分なことも多いですが、スクリプト化や CI のために CLI も使えるようにしておきます。

### 準備: Cloud Shell が手軽

コンソール右上の **Cloud Shell**（`>_` アイコン）を開くと、`gcloud` と `bq` がインストール済みで、認証も済んだターミナルが使えます。
手元の PC で使う場合は、Google Cloud CLI をインストールしてから認証します。

```bash
gcloud auth login                         # ブラウザで Google アカウントにログイン
gcloud config set project <プロジェクトID>  # 既定のプロジェクト（課金先）を設定
```

### ⚠️ まず「レガシー SQL」をオフにする

`bq query` は、歴史的な経緯で **レガシー SQL** という古い方言を既定にしています。この教材で使うのは標準の **GoogleSQL** です。
毎回 `--use_legacy_sql=false` を付けるか、ホームディレクトリに `~/.bigqueryrc` を作って既定値を変えます。

```ini
# ~/.bigqueryrc
[query]
--use_legacy_sql=false
```

### よく使うコマンド

```bash
# データセットのテーブル一覧（CLI では「プロジェクト:データセット」とコロンで区切る）
bq ls bigquery-public-data:thelook_ecommerce

# スキーマを見る
bq show --schema --format=prettyjson bigquery-public-data:thelook_ecommerce.orders

# 先頭の行を見る（プレビュー。無料）
bq head -n 5 bigquery-public-data:thelook_ecommerce.orders

# ドライラン（実行せずに処理バイト数だけを表示）
bq query --dry_run \
  'select status, count(*) from `bigquery-public-data.thelook_ecommerce.orders` group by status'

# 実行（最大課金バイト数を 1 GB に制限。超えるならエラーで止まり、課金されない）
bq query --maximum_bytes_billed=1000000000 \
  'select status, count(*) as n from `bigquery-public-data.thelook_ecommerce.orders` group by status'
```

`--maximum_bytes_billed` は、Athena のワークグループの「クエリあたりのデータ使用量制限」に相当する **安全装置** です。
コンソールでも、クエリの設定（その他 → クエリ設定 → 詳細オプション）から指定できます。

> 📝 **CLI とコンソールの表記の違い**
> SQL の中では `` `project.dataset.table` ``（ドット区切り＋バッククォート）、`bq` コマンドの引数では `project:dataset.table`（プロジェクトの後だけコロン）と書きます。

## 2.6 自分のデータセットとテーブルを作る

### データセットを作る

第1章のとおり、公開データセットと JOIN できるよう、ロケーションは **`US`** にします。

```bash
bq mk --dataset --location=US <プロジェクトID>:study
```

コンソールなら、エクスプローラで自分のプロジェクトの「︙」→「データセットを作成」から作れます（ロケーションタイプ: マルチリージョン → US）。

### CTAS でテーブルを作る

sandbox では INSERT などの DML は使えませんが、**`CREATE TABLE ... AS SELECT`（CTAS）** は使えます。

```sql
create or replace table study.completed_orders as
select
  order_id,
  user_id,
  status,
  created_at,
  num_of_item
from `bigquery-public-data.thelook_ecommerce.orders`
where status = 'Complete'
```

既定のプロジェクトが自分のプロジェクトであれば、`study.completed_orders` のようにプロジェクト名を省略できます。

```sql
-- 自分のテーブルにクエリ
select
  date_trunc(date(created_at), month) as order_month,
  count(*) as orders
from study.completed_orders
group by order_month
order by order_month
```

作ったテーブルの **詳細** タブで、行数・サイズ・**有効期限**（sandbox なら60日後）を確認してください。

> 💡 Athena の CTAS では、出力先の S3 パスやファイル形式（`format = 'PARQUET'` など）を指定していたと思います。BigQuery では不要です。

## 演習

**2-1.** 2.4 節の表を埋めてください。そのうえで、①と③の比を計算し、`orders` テーブルの列のうち `status` が全体のどれくらいの割合を占めるか推定してください。

<details><summary>解答の考え方</summary>

列指向なので、③ ÷ ① ≒「`status` 列のサイズ ÷ テーブル全体のサイズ」です。
テーブルの詳細タブにある「論理バイト数」と比べてみてください。
文字列の列は値の長さに比例して大きくなり、`INT64` や `TIMESTAMP` は1値あたり8バイトです。

</details>

**2-2.** 次のクエリを、**処理バイト数がなるべく小さくなるように** 書き直してください。結果は同じにします。

```sql
select *
from `bigquery-public-data.thelook_ecommerce.users`
where country = 'Japan'
limit 100
```

<details><summary>解答</summary>

必要な列だけを `select` します。たとえば名前と年齢だけが必要なら、次のようにします。

```sql
select first_name, last_name, age
from `bigquery-public-data.thelook_ecommerce.users`
where country = 'Japan'
limit 100
```

読むのは `first_name`、`last_name`、`age`、`country` の4列です。`limit 100` は、処理バイト数には影響しません。
「全列が本当に必要か」を最初に疑うのが、BigQuery のコスト管理の第一歩です。

</details>

**2-3.** `bq query --maximum_bytes_billed=1` で、2.3 節のクエリを実行してください。何が起きますか？ 課金はされるでしょうか？

<details><summary>解答</summary>

上限を超えるため、クエリは実行されずにエラーになります（「Query exceeded limit for bytes billed」のようなメッセージ）。
**課金はされません。** CI や定期実行するクエリには、必ず上限を付けておくと安全です。

</details>

**2-4.** `study` データセットに、`users` から日本の会員だけを抜き出した `study.users_japan` テーブルを CTAS で作り、性別ごとの人数を集計してください。

<details><summary>解答</summary>

```sql
create or replace table study.users_japan as
select id, first_name, last_name, age, gender, city, traffic_source, created_at
from `bigquery-public-data.thelook_ecommerce.users`
where country = 'Japan'
```

```sql
select gender, count(*) as users
from study.users_japan
group by gender
```

2つ目のクエリは、自分の小さなテーブルを読むだけなので、ほとんど課金されません（ただし、テーブルごとに最低 10 MB として計算されます）。
よく使う部分集合を自分のテーブルに切り出しておくのは、コストを抑える基本テクニックです。

</details>

## つまずきポイント

- **`bq query` の結果がおかしい・構文エラーになる** … レガシー SQL で解釈されています。`--use_legacy_sql=false` か `~/.bigqueryrc` を確認してください。
- **`Not found: Dataset ... was not found in location asia-northeast1`** … データセットのロケーションが違います。公開データセットと組み合わせるなら `US` に作り直します（ロケーションは変更できません）。
- **バッククォートを忘れる** … `bigquery-public-data` のハイフンが引き算と解釈されて、構文エラーになります。プロジェクト名を含む名前は、バッククォートで囲みます。
- **sandbox で `INSERT` がエラーになる** … sandbox では DML が使えません。CTAS で作り直すか、課金を有効にします。
- **60日後にテーブルが消えた** … sandbox の既定の有効期限です。残したいデータは、課金を有効にしたうえで、データセットの既定の有効期限を変更します。

## まとめ

- 学習は **BigQuery sandbox** で始める（カード不要・無料枠内。DML 不可、60日で期限切れ）
- **実行前にドライランで処理バイト数を見る**。`SELECT *` と `LIMIT` に頼らず、列を絞る
- 中身を見るだけならプレビュー（無料）。同じクエリは24時間キャッシュされる
- `bq` CLI ではレガシー SQL をオフにし、`--maximum_bytes_billed` で安全装置をかける
- 自分のデータセットは、公開データと同じ `US` に作る。sandbox でも CTAS は使える

Sources: [Enable the BigQuery sandbox](https://cloud.google.com/bigquery/docs/sandbox), [BigQuery pricing](https://cloud.google.com/bigquery/pricing)

⬅️ 前章: [第1章](01-overview.md) ／ ➡️ 次章: [第3章 GoogleSQL 入門](03-googlesql.md)
