# 第8章 サンプル: クライアントとリソースサーバーをつなぐ

基礎編の完成形です。4〜7 章の IdP を 1 つに統合し、Web クライアント・リソースサーバー・SPA をつなぎます。応用編 (9〜19 章) のサンプルは、この章の `idp/` をコピーして出発します。

| ディレクトリ | 中身 | ポート | 技術 |
|---|---|---|---|
| `idp/` | IdP (Spring Authorization Server) | 9000 | Maven / Spring Boot 4.1.2 |
| `resource-server/` | ノート API (JWT を検証) | 8090 | Maven / `oauth2-resource-server` |
| `web-client/` | Web アプリ (`oauth2Login`) | 8080 | Maven / `oauth2-client` + Thymeleaf |
| `spa/` | ブラウザの SPA (PKCE を自前実装) | 5173 | TypeScript + Vite |
| `e2e/` | ブラウザ (Playwright) での通し確認 | - | Node.js |

## 前提

Java 21、Maven、Node.js 22。ブラウザは次の URL で開きます。**ホスト名の違いに意味があります** (本文参照)。

| 開く URL | 用途 |
|---|---|
| `http://localhost:9000` | IdP (issuer と同じホスト名) |
| `http://127.0.0.1:8080` | Web クライアント |
| `http://127.0.0.1:5173` | SPA |

## テスト

```bash
(cd idp && mvn test)               # 86 件
(cd resource-server && mvn test)   # 13 件
(cd web-client && mvn test)        # 6 件
(cd spa && npm install && npm test)  # 10 件 (vitest)
```

## 起動

IdP を最初に起動します (Web クライアントは起動時に IdP のディスカバリを取りに行くため)。ターミナルを 4 つ使います。

```bash
# 1. IdP (初回起動で keys/ に署名鍵、target/ に H2 の DB を作り、クライアントとユーザーを登録する)
cd idp && mvn spring-boot:run

# 2. リソースサーバー
cd resource-server && mvn spring-boot:run

# 3. Web クライアント
cd web-client && mvn spring-boot:run

# 4. SPA
cd spa && npm install && npm run dev
```

ユーザーは `alice` / `password` (通常)、`bob` / `legacy-pass` (旧形式ハッシュ)、`carol` / `password` (無効化済み)。学習用の固定値で、本番では使えません。

## 確かめ方

### Web クライアント

1. `http://127.0.0.1:8080/` を開き「IdP でログイン」を押す。
2. IdP のログイン画面 (`localhost:9000`) で `alice` / `password`。
3. 同意画面で「許可する」。Web クライアントに戻り、ID トークンのクレームが表示される。
4. 「リソースサーバーを呼ぶ」を押すと `/api/me` と `/api/notes` の結果が出る。
5. 「ログアウト (このアプリだけ)」のあと、もう一度「IdP でログイン」を押すと、パスワードを聞かれずに戻る (IdP のセッションが残っているため)。

### SPA

1. `http://127.0.0.1:5173/` を開き「IdP でログイン」を押す (同意画面は出ない)。
2. ボタンで UserInfo、`/api/me`、`/api/notes` を呼ぶ。
3. アクセストークンが切れたあとは、API ボタンを押すと IdP へ遷移し、ログイン済みなら画面遷移だけで戻って結果が出る。

### アクセストークンの寿命を短くして試す

既定は 15 分です。更新や期限切れを待たずに見たいときは、**空の DB で** IdP を起動し直します (クライアントの設定は初回起動のときに DB に入り、以後は書き換わらないため)。

```bash
cd idp
rm -rf target/idp-db*                  # DB を消す (署名鍵 keys/ は残してよい)
mvn spring-boot:run -Dspring-boot.run.arguments=--idp.token.access-token-ttl=PT75S
```

### E2E

4 つを上の「寿命を短くして試す」の設定 (`PT75S`、空の DB) で起動してから実行します。同意画面とパスワード入力が出る前提なので、実行のたびに IdP の DB を空にしてください。約 2 分かかります (トークンの期限を待つため)。

```bash
cd e2e
node run.cjs
```

Playwright は事前にインストールされているものを使います (`playwright install` は不要)。

### Cookie の衝突を再現する

本文の「つまずきポイント」の再現用です。通常の動作確認では不要です。

1. IdP を空の DB で一度起動して止め、DB の `web-client` の redirect_uri に `http://localhost:8080/login/oauth2/code/idp` を足す (H2 の Shell で `UPDATE oauth2_registered_client SET redirect_uris = redirect_uris || ',http://localhost:8080/login/oauth2/code/idp' WHERE client_id='web-client'`)。
2. IdP と Web クライアントを `--server.servlet.session.cookie.name=JSESSIONID` 付きで起動する。
3. `node e2e/cookie-collision.cjs`

## 後片付け

`idp/keys/` (署名鍵)、`idp/target/idp-db*` (DB)、`spa/node_modules/` はコミットしません (`.gitignore` 済み)。
