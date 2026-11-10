# 執筆ルール

この教材の章とサンプルを書くときの決まりです。章を追加・修正するときはここに従います。

## 読者

- Java と TypeScript を書ける開発者。Spring Boot は触ったことがある程度。
- OAuth / OIDC は用語を聞いたことがある程度。
- ドメインモデルから設計を考えるのが好きで、新しい概念はアナロジーがあると理解しやすい。
- 完成形から逆算して計画を立てる。

## 章の構成

各章は次の順で書きます。見出し名はこのとおりにします。

1. `# 第N章 タイトル`
2. `## この章のゴール` — 章を終えたときに動いているもの・説明できることを 3〜5 項目。完成形を先に見せる。
3. `## ドメインモデル上の位置づけ` — 1 章のモデル (User / Client / Authorization / Consent / Session / Token) のどこを扱うか。Mermaid 図を 1 つ入れる。
4. `## たとえると` — その章の中心概念のアナロジーを 1 つ。全章共通の舞台は「ホテル」(IdP = フロント、クライアント = 提携施設、トークン = カードキー、リソースサーバー = 客室やジムの扉)。たとえが合わない箇所は、どこが合わないかも書く。
5. 本編 (見出しは内容に合わせて自由)。仕組みの説明 → コード → 動作確認の順。
6. `## つまずきポイント` — 実際にはまりやすい点を、症状 → 原因 → 対処で。
7. `## まとめ` — 箇条書き 3〜6 項目。
8. `## 次の章へ` — 2〜3 文。

長さは Markdown で 300〜500 行が目安です。

## 文章

- 日本語、です・ます調。
- 用語は初出で定義する。RFC やプロトコルの用語は英語のまま書き、初出で日本語の説明を添える (例: `issuer` (発行者。IdP 自身を表す URL))。
- 図は Mermaid (`sequenceDiagram` / `classDiagram` / `flowchart`)。
- 本文に載せるコードは、サンプルのファイルからの抜粋と一致させる。抜粋の前にファイルパスを書く。
- 動作確認の手順には、実際に実行して得た出力を載せる。実行していない出力を書かない。
- 確かめられなかったことは「未検証」と明記する。推測を事実のように書かない。
- 仕様の根拠を示すときは RFC 番号や仕様名を書く (例: RFC 7636、OpenID Connect Core 1.0)。

## サンプルコード

- 置き場所は `samples/chNN-slug/`。独立した Maven プロジェクトにする。
- 3〜7 章は `samples/ch02-minimal-idp` をコピーして、その章の差分だけを足す。`pom.xml` の `artifactId` / `name` / `description` は章に合わせて変える。
- パッケージは `com.example.idp`。
- 章で説明する動作は必ずテストで固定する。`mvn test` が通ることが完成条件。
- テストメソッド名は日本語で「何が起きるか」を書く。
- コメントは「なぜそうするか」を日本語で書く。
- 秘密情報は学習用の固定値でよいが、本番で使えないものにはその旨をコメントする。

## 検証済みの事実 (Spring Boot 4.1.2 / Spring Security 7.1.2)

記憶にある旧バージョンの API と違う箇所があります。ここに書いたことは実際にビルドして確かめた内容です。

- Authorization Server は Spring Security 本体に入っている。artifact は `org.springframework.security:spring-security-oauth2-authorization-server:7.1.2`。Java パッケージは従来どおり `org.springframework.security.oauth2.server.authorization.*`。
- スターター名: `spring-boot-starter-webmvc`、`spring-boot-starter-security-oauth2-authorization-server`、`spring-boot-starter-security-oauth2-client`、`spring-boot-starter-security-oauth2-resource-server`、`spring-boot-starter-thymeleaf`、`spring-boot-starter-jdbc`、`spring-boot-starter-flyway`。
- テスト用スターターは機能ごとに分かれている: `spring-boot-starter-webmvc-test`、`spring-boot-starter-security-oauth2-authorization-server-test`、`spring-boot-starter-jdbc-test` など。
- `@AutoConfigureMockMvc` のパッケージは `org.springframework.boot.webmvc.test.autoconfigure`。
- 認可サーバーの設定は `http.oauth2AuthorizationServer(as -> { http.securityMatcher(as.getEndpointsMatcher()); as.oidc(withDefaults()); })` と書く (`samples/ch02-minimal-idp` の `SecurityConfig` を参照)。
- 未ログインで `/oauth2/authorize` に来たときのリダイレクト先は相対パスの `/login`。
- MockMvc のテストで `user("user")` を使って認証を差し込むと、ID トークン生成が `authenticationTime cannot be null` で失敗する。`formLogin()` で実際にログインしてセッションを引き回す (`IdpApplicationTests` を参照)。
- 既定のエンドポイント: `/oauth2/authorize`、`/oauth2/token`、`/oauth2/jwks`、`/oauth2/revoke`、`/oauth2/introspect`、`/userinfo`、`/connect/logout`、`/.well-known/openid-configuration`。

ここに無い API は、記憶ではなく実物で確かめます。

- ソース jar: `~/.m2/repository/org/springframework/security/<artifact>/7.1.2/<artifact>-7.1.2-sources.jar` (`unzip -p` で読める)。
- クラスのシグネチャ: `javap -cp <jar> <FQCN>`。
- 最終的な根拠はコンパイルとテストの成功。
