# study-dbt — TypeScript / Java エンジニアのための dbt 入門

dbt（data build tool）を、**アプリケーション開発の経験はあるがデータ基盤は初めて**という中級プログラマ向けに、いちから学ぶ教材です。

- 題材: 架空のコーヒー豆 EC「**Bean Voyage**」の売上分析基盤
- 環境: **dbt v2**（Rust 製の新エンジン）+ **DuckDB**（ローカルファイルDB）— クラウドアカウント不要・無料
- スタイル: 各章で dbt の概念を **TS / Java の知っている概念にたとえて** から手を動かす

## ゴール（逆算の起点）

この教材を終えたとき、次の状態になっていることを目指します。

> 生データ（raw）から、**テスト・ドキュメント・型（contract）で守られた分析用データモデル**を dbt で設計・実装し、
> CI で安全に変更できる状態を、自分の言葉で TS / Java に置き換えて説明できる。

具体的には、[`coffee_shop/`](./coffee_shop)（完成版）と同等のプロジェクトを、自分の手で [`my_coffee_shop/`](#学び方) として作り上げます。

| マイルストーン（逆順） | 到達状態 | 章 |
|---|---|---|
| 5 | 本番運用・チーム開発（CI / 鮮度監視 / スケジュール）を説明できる | 12–14 |
| 4 | 差分ビルドと履歴管理で、大きく変化するデータを扱える | 10–11 |
| 3 | テスト・contract・ドキュメントで品質を担保できる | 6–9 |
| 2 | ドメインモデリングに基づくレイヤー設計で marts を作れる | 4–5 |
| 1 | source → staging → ref の基本ループを回せる | 1–3, 補講A |
| 0 | 完成形を動かして「何を作るのか」を知る | **0** |

## 章立て

参考にした書籍: 『実践dbt入門』（技術評論社, 2026）、*Analytics Engineering with SQL and dbt*（O'Reilly, 2023）、*Data Engineering with dbt*（Packt, 2023）。
これらの「課題 → ハンズオン → テスト/ドキュメント → モデリング → 運用」という流れをベースに、**ドメインモデリングを前半に移動**し、アプリエンジニア向けのアナロジーを足しています。

| # | 章 | ひとことで | TS / Java でいうと |
|---|---|---|---|
| 0 | [完成形を先に見る](docs/00-goal.md) | 動かしてゴールを知る | 完成したリポジトリを clone して動かす |
| | **Part I — dbt とは何か** | | |
| 1 | [dbt の立ち位置](docs/01-what-is-dbt.md) | ELT の T を担う「SQL のビルドツール」 | Gradle / tsc |
| 2 | [環境構築と最初のモデル](docs/02-setup-first-model.md) | `dbt init` → `dbt run` | `npm init` → `npm run build` |
| 3 | [model・ref・source・seed](docs/03-models-ref-source.md) | DAG を組み立てる部品 | 純粋関数・import・外部 API の型宣言・fixture |
| A | [補講: アプリエンジニアのための分析 SQL](docs/appendix-a-analytical-sql.md) | 集合で考える | `stream()` / `Array.prototype` のメソッドチェーン |
| | **Part II — ドメインモデリング** | | |
| 4 | [分析のためのドメインモデリング](docs/04-dimensional-modeling.md) | ファクト / ディメンション / 粒度 | ドメインイベント / エンティティ |
| 5 | [レイヤー設計](docs/05-layers.md) | staging → intermediate → marts | 腐敗防止層 → ドメイン層 → 公開 API |
| | **Part III — 品質を守る** | | |
| 6 | [テスト](docs/06-testing.md) | data test と unit test | 不変条件アサーション / JUnit・Jest |
| 7 | [contract・access・version](docs/07-contracts-access.md) | モデルに「型」と「可視性」を | interface / public・private / API バージョニング |
| 8 | [ドキュメントとリネージ](docs/08-docs-lineage.md) | 自動生成されるデータカタログ | Javadoc / TypeDoc + 依存グラフ |
| | **Part IV — DRY とパフォーマンス** | | |
| 9 | [Jinja・マクロ・パッケージ](docs/09-jinja-macros.md) | SQL を生成するテンプレート | テンプレートエンジン / ユーティリティ関数 / npm・Maven |
| 10 | [マテリアライゼーションと incremental](docs/10-materializations.md) | どう実体化するか | 遅延評価 / キャッシュ / 差分ビルド |
| 11 | [スナップショット](docs/11-snapshots.md) | 上書きされる値の履歴を残す | イベントソーシング / 監査ログ |
| | **Part V — チーム開発と運用** | | |
| 12 | [チーム開発と CI](docs/12-ci.md) | `dbt lint` / `dbt fmt` と Slim CI | ESLint・Prettier / 影響範囲だけテスト（Nx affected） |
| 13 | [本番運用](docs/13-production.md) | 環境・スケジュール・監視 | Spring プロファイル / cron / ヘルスチェック |
| 14 | [総仕上げと発展](docs/14-capstone-next.md) | 新ドメイン追加の課題と dbt v2 | 機能追加の PR を 1 本出す |

各章は **ゴール → アナロジー → 解説 → ハンズオン → 演習（解答つき） → つまずきポイント → まとめ** の順に構成しています。

## セットアップ

前提: macOS または Linux（Windows は WSL を推奨）、Python 3.10 以上、make、git、curl。

### 1. dbt v2 をインストール

dbt v2 は Python パッケージではなく、**単体のバイナリ** です。公式のインストーラで `~/.local/bin/dbt` に入ります。

```bash
curl -fsSL https://public.cdn.getdbt.com/fs/install/install.sh | sh -s -- --update --version 2.0.12
exec $SHELL          # PATH を読み直す
dbt --version        # dbt 2.0.12 と表示されれば OK
```

`make install-dbt` でも同じコマンドが実行されます。`--version` を外すと最新の安定版が入ります。

### 2. ロードスクリプトの準備とビルド

```bash
cd study-dbt
make setup        # .venv を作り、ロードスクリプト用の duckdb（Python）をインストール
make load-day1    # 生データを DuckDB の raw スキーマへロード
make build        # 完成版 coffee_shop をビルド
```

最後に `Summary: 77 total | 75 success | 2 no-op` と出れば成功です。

`make` を使わない場合:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/load_raw.py --day day1
cd coffee_shop && dbt build
```

> ⚠️ **DuckDB のバージョンをそろえる**
> dbt v2 は DuckDB を内蔵しています（2.0.12 では DuckDB 1.5.4）。ロードスクリプトが使う Python 版の DuckDB は、`requirements.txt` で同じ 1.5.4 に固定しています。
> 別のバージョンで作った DB ファイルは、dbt から読めないことがあります（`Trying to read a database file with version number ...` というエラー）。
> dbt v2 を上げたら、`dbt show --inline "select version()"` で内蔵の DuckDB のバージョンを確かめ、`requirements.txt` もそろえてください。

## 学び方

- `coffee_shop/` … **完成版（模範解答）**。迷ったらここを見る。
- `my_coffee_shop/` … **あなたが作るプロジェクト**。第2章で `dbt init` して作り、章を追うごとに育てる。

```text
study-dbt/
├── README.md                 ← いまここ
├── docs/                     ← 教材本文（第0〜14章 + 補講A）
├── coffee_shop/              ← 完成版 dbt プロジェクト
├── my_coffee_shop/           ← （第2章で作成）あなたの dbt プロジェクト
├── data/raw/day1, day2/      ← 生データ CSV（day2 = 2週間後の状態）
├── scripts/
│   ├── generate_data.py      ← CSV 生成（乱数シード固定）
│   └── load_raw.py           ← なんちゃって EL ツール（CSV → raw スキーマ）
├── ci/dbt-ci.yml             ← GitHub Actions サンプル（第12章）
├── Makefile
└── requirements.txt          ← ロードスクリプト用（duckdb のみ）
```

## 動作確認済みのバージョン

| ソフトウェア | バージョン |
|---|---|
| dbt（v2） | 2.0.12（内蔵 DuckDB 1.5.4） |
| duckdb（Python、ロードスクリプト用） | 1.5.4 |
| Python | 3.13 |

2026年時点の dbt には、Rust 製の新エンジンによる **dbt v2**（旧称 Fusion。新規インストールの既定）と、Python 製の **dbt v1（dbt Core）** があります。
この教材は **v2** で書いています。v1 との違いは[第1章](docs/01-what-is-dbt.md)と[第14章](docs/14-capstone-next.md)で扱います。
