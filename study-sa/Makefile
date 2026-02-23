.PHONY: build up down restart logs clean

## ホストでMavenビルドを実行してWARを生成
build:
	mvn package -f sample/pom.xml

## Tomcatコンテナを起動（バックグラウンド）
up:
	docker compose up -d

## Tomcatコンテナを停止・削除
down:
	docker compose down

## ビルド後にコンテナを再起動（WARの更新に使用）
restart: build
	docker compose down
	docker compose up -d

## コンテナのログを表示
logs:
	docker compose logs -f

## クリーンビルド（target, WEB-INF/lib, WEB-INF/classesを削除）
clean:
	mvn clean -f sample/pom.xml
