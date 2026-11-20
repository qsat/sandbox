# study-dbt 用のショートカット。npm scripts / Gradle タスクのようなもの。
# 例: make setup && make load-day1 && make build
PY      := .venv/bin/python
DBT     := ../.venv/bin/dbt
PROJECT ?= coffee_shop
DB      ?= $(PROJECT)/$(PROJECT).duckdb

.PHONY: setup setup-dev data load-day1 load-day2 seed build snapshot test freshness docs lint reset

setup:            ## Python 仮想環境を作り dbt をインストール
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

setup-dev: setup  ## + SQLFluff（第12章）
	.venv/bin/pip install -r requirements-dev.txt

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

lint:
	cd $(PROJECT) && ../.venv/bin/sqlfluff lint models tests analyses

reset:            ## DuckDB ファイルとビルド成果物を削除して最初からやり直す
	rm -f $(DB) $(DB).wal
	cd $(PROJECT) && $(DBT) clean
