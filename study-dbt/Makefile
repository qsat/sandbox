# study-dbt 用のショートカット。npm scripts / Gradle タスクのようなもの。
# 例: make install-dbt && make setup && make load-day1 && make build
#
# dbt 本体は v2（単体バイナリ）。PATH 上の dbt を使う。別の場所のバイナリを使うなら
#   make build DBT=/path/to/dbt
PY      := .venv/bin/python
DBT     ?= dbt
DBT_VERSION ?= 2.0.12
PROJECT ?= coffee_shop
DB      ?= $(PROJECT)/$(PROJECT).duckdb

.PHONY: install-dbt setup data load-day1 load-day2 build snapshot test freshness docs lint fmt fmt-check reset

install-dbt:      ## dbt v2 を公式インストーラで ~/.local/bin に入れる（公式ドキュメントの手順そのまま）
	curl -fsSL https://public.cdn.getdbt.com/fs/install/install.sh | sh -s -- --update --version $(DBT_VERSION)

setup:            ## Python 仮想環境を作り、ロードスクリプト用の duckdb をインストール
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

data:             ## CSV を再生成（通常は不要。リポジトリに同梱済み）
	$(PY) scripts/generate_data.py

load-day1:        ## raw スキーマへ day1 のデータをロード
	$(PY) scripts/load_raw.py --day day1 --db $(DB)

load-day2:        ## raw スキーマへ day2 のデータをロード（第10・11章）
	$(PY) scripts/load_raw.py --day day2 --db $(DB)

build:            ## seed → run → test → snapshot をDAG順に一括実行
	cd $(PROJECT) && $(DBT) build

snapshot:
	cd $(PROJECT) && $(DBT) snapshot

test:
	cd $(PROJECT) && $(DBT) test

freshness:
	cd $(PROJECT) && $(DBT) source freshness

docs:             ## ドキュメントサイトを生成して http://localhost:8080 で表示
	cd $(PROJECT) && $(DBT) docs generate && $(DBT) docs serve --port 8080

lint:             ## SQL の Lint（第12章）
	cd $(PROJECT) && $(DBT) lint

fmt:              ## SQL の自動整形（第12章）
	cd $(PROJECT) && $(DBT) fmt models

fmt-check:        ## 整形済みかの確認だけ（CI 用）
	cd $(PROJECT) && $(DBT) fmt --check models

reset:            ## DuckDB ファイルとビルド成果物を削除して最初からやり直す
	rm -f $(DB) $(DB).wal
	cd $(PROJECT) && $(DBT) clean
