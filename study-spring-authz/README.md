# study-spring-authz

Spring Authorization Server で IdP (OpenID プロバイダー) を作りながら、Java のアプリ開発を学ぶ教材です。

## 完成形 (ここから逆算して章を並べています)

- OIDC 準拠の IdP: 認可コード + PKCE、リフレッシュトークン、ログアウト
- 複数のクライアント (SPA / Web アプリ / バッチ) が接続し、client_id ごとにセッションと認証ポリシーが独立している
- DB 永続化、鍵ローテーション、多要素認証、監査ログを備える

## 前提バージョン

| 項目 | バージョン |
|---|---|
| Java | 21 |
| Spring Boot | 4.1.2 |
| Spring Security (Authorization Server を含む) | 7.1.2 |
| ビルド | Maven |

Spring Authorization Server は Spring Security 7 で本体に統合されました。この教材はその統合後の構成で書いています。

## 章立て

### 基礎編: 動く IdP を作りながら仕組みを理解する

| 章 | テーマ | 本文 | サンプル |
|---|---|---|---|
| 1 | 全体像とドメインモデル | [docs/basic/01-overview-domain-model.md](docs/basic/01-overview-domain-model.md) | なし |
| 2 | 開発環境と最小構成 | [docs/basic/02-minimal-idp.md](docs/basic/02-minimal-idp.md) | [samples/ch02-minimal-idp](samples/ch02-minimal-idp) |
| 3 | Spring Security の基礎 | [docs/basic/03-spring-security-basics.md](docs/basic/03-spring-security-basics.md) | [samples/ch03-security-basics](samples/ch03-security-basics) |
| 4 | 認可コードフロー + PKCE | [docs/basic/04-authorization-code-pkce.md](docs/basic/04-authorization-code-pkce.md) | [samples/ch04-authorization-code-pkce](samples/ch04-authorization-code-pkce) |
| 5 | トークン | [docs/basic/05-tokens.md](docs/basic/05-tokens.md) | [samples/ch05-tokens](samples/ch05-tokens) |
| 6 | ユーザー認証と同意画面 | [docs/basic/06-login-consent.md](docs/basic/06-login-consent.md) | [samples/ch06-login-consent](samples/ch06-login-consent) |
| 7 | 永続化 | [docs/basic/07-persistence.md](docs/basic/07-persistence.md) | [samples/ch07-persistence](samples/ch07-persistence) |
| 8 | クライアントとリソースサーバーをつなぐ | [docs/basic/08-integration.md](docs/basic/08-integration.md) | [samples/ch08-integration](samples/ch08-integration) |

### 応用編: 実務要件を実装する

| 章 | テーマ |
|---|---|
| 9 | トークンのカスタマイズ |
| 10 | client_id ごとのユーザーセッション分離 |
| 11 | クライアント別の認証ポリシー |
| 12 | ログアウト設計 |
| 13 | 多要素認証 |
| 14 | 外部 IdP 連携 |
| 15 | マルチテナント |
| 16 | 追加のグラントとクライアント管理 |
| 17 | セキュリティ強化 |
| 18 | 運用と可観測性 |
| 19 | テストと仕上げ |

## サンプルコードの持ち方

- 3〜7 章のサンプルは「2 章の最小構成 + その章の差分」です。章ごとに独立しているので、差分だけを読めます。
- 8 章で 4〜7 章の差分を 1 つの IdP に統合し、クライアントとリソースサーバーをつなぎます。これが基礎編の完成形です。
- 応用編のサンプルは「8 章の IdP + その章の差分」です。

各サンプルは独立した Maven プロジェクトです。

```bash
cd samples/ch02-minimal-idp
mvn test              # テストで動作を確認
mvn spring-boot:run   # http://localhost:9000 で起動
```

## ポート

| アプリ | ポート |
|---|---|
| IdP | 9000 |
| Web クライアント | 8080 |
| リソースサーバー | 8090 |
| SPA (開発サーバー) | 5173 |

執筆ルールは [AUTHORING.md](AUTHORING.md) にあります。
