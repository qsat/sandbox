# 第4章 認可コードフロー + PKCE

## この章のゴール

- ブラウザのリダイレクトと、クライアントからのトークンリクエストを 1 本ずつ追い、認可コードフロー (Authorization Code Flow) を説明できる。
- PKCE (Proof Key for Code Exchange。RFC 7636) が防ぐ攻撃と、`S256` の計算方法を説明できる。
- `RegisteredClient` の各設定項目の意味を言え、confidential client (Web アプリ) と public client (SPA) を登録し分けられる。
- redirect_uri 不一致、未登録 scope、code_verifier 不一致、認可コードの再利用などの失敗が「どの形で」「なぜ」返るかを、実際のレスポンスで言える。
- 認可コードの発行から使用済みまでの間に、IdP 内部の `OAuth2Authorization` に何が保存されるかを、テストで確かめられる。

完成形はサンプル `samples/ch04-authorization-code-pkce` です。`mvn test` が 31 件通ります (うち 3 件は 2 章から引き継いだテスト)。

## ドメインモデル上の位置づけ

1 章のモデルのうち、この章では **Client** と **Authorization** が主役です。Client は「誰が」IdP に頼むのかの台帳 (`RegisteredClient`)、Authorization は「誰が・どのクライアントに・何を許したか」の記録 (`OAuth2Authorization`) です。Token は Authorization にぶら下がります。Session と Consent は 6 章で扱います。

```mermaid
classDiagram
    class User
    class RegisteredClient {
        clientId
        clientAuthenticationMethod
        authorizationGrantType
        redirectUri
        scope
        ClientSettings
        TokenSettings
    }
    class OAuth2Authorization {
        principalName
        authorizedScopes
        attributes: 認可リクエスト
    }
    class Token {
        authorizationCode
        accessToken
        refreshToken
        idToken
    }
    User "1" --> "*" OAuth2Authorization : 許可する
    RegisteredClient "1" --> "*" OAuth2Authorization : 宛先
    OAuth2Authorization "1" --> "0..*" Token : 保持する
```

## たとえると

ホテルの宿泊客 (ユーザー) が、提携施設のスパ (クライアント) を使いたいとします。

1. スパの受付は客に「フロントで引換券をもらってきてください」と言い、客をフロントへ向かわせます (認可リクエスト)。
2. フロントは宿泊客本人であることを確認し (ログイン)、**使い捨ての引換券 (認可コード)** を客に渡します。客はそれをスパの受付に持っていきます (リダイレクト)。
3. スパの受付は、その引換券をフロントに持っていき、**カードキー (アクセストークン)** と交換します (トークンリクエスト)。

引換券を客経由で運ぶのは、カードキーを客の目に触れる場所 (ブラウザの URL など) に出さないためです。

たとえが合わない点が 2 つあります。

- 現実の引換券は誰が持ち込んでも交換できますが、認可コードは「**最初に認可リクエストを出したクライアントだけ**」が交換できます。この結びつけに使うのが PKCE です (後述)。
- 現実のホテルは使用済みの引換券を黙って無視するかもしれませんが、IdP は再利用を「盗まれた疑い」とみなし、発行済みのカードキーまで無効にします。

## 認可コードフローを 1 リクエストずつ追う

登場人物は 4 者です。**User Agent** (ブラウザ)、**Client** (Web アプリなど)、**IdP** (authorization server)、**ユーザー** (人間)。

```mermaid
sequenceDiagram
    autonumber
    participant UA as ブラウザ
    participant C as クライアント
    participant IdP as IdP (/oauth2/*)
    C->>C: code_verifier を生成し code_challenge = S256(verifier) を計算
    C->>UA: 302 IdP の /oauth2/authorize へ
    UA->>IdP: GET /oauth2/authorize?response_type=code&client_id&redirect_uri&scope&state&nonce&code_challenge
    IdP-->>UA: 302 /login (未ログインの場合)
    UA->>IdP: ログイン (ユーザー名・パスワード)
    UA->>IdP: GET /oauth2/authorize?... (ログイン後に再開)
    IdP-->>UA: 302 redirect_uri?code=...&state=...
    UA->>C: GET redirect_uri?code=...&state=...
    C->>C: state を照合
    C->>IdP: POST /oauth2/token (grant_type=authorization_code, code, redirect_uri, code_verifier)
    IdP->>IdP: クライアント認証 / code と redirect_uri / SHA256(code_verifier) を照合
    IdP-->>C: 200 access_token, refresh_token, id_token
```

ブラウザ経由の区間 (図の 2〜8) は **フロントチャネル**、クライアントと IdP が直接話す区間 (図の 10〜12) は **バックチャネル**と呼びます。認可コードはフロントチャネルを通る (= 第三者に見られうる) 値、トークンはバックチャネルだけを通る値、という分担です。

### 1. 認可リクエスト

クライアントはブラウザを次の URL に向かわせます (読みやすいよう改行しています)。

```
GET /oauth2/authorize
  ?response_type=code
  &client_id=web-client
  &redirect_uri=http://127.0.0.1:8080/login/oauth2/code/idp
  &scope=openid%20profile
  &state=xyz
  &nonce=n-0S6_WzA2Mj
  &code_challenge=HJBdpkC_B-Mnzm5aPbGvpAlCHyaap_U6w6hg37BvXWA
  &code_challenge_method=S256
```

| パラメーター | 役割 |
|---|---|
| `response_type=code` | 「認可コードを返してほしい」。認可コードフローでは固定 |
| `client_id` | どのクライアントか。`RegisteredClient.clientId` と一致が必要 |
| `redirect_uri` | コードの返し先。登録値と**完全一致**が必要 |
| `scope` | 求める権限。空白区切り。`openid` を含めると OIDC になり ID トークンも出る |
| `state` | クライアントが作る使い捨ての乱数。戻ってきたとき照合し、CSRF (他人が開始した認可の結果を自分のセッションに紐づけさせる攻撃) を防ぐ。IdP は加工せずそのまま返す |
| `nonce` | OIDC のパラメーター。IdP が ID トークンの `nonce` クレームにそのまま入れる。クライアントが ID トークンの再送 (リプレイ) を見抜くために照合する |
| `code_challenge` | PKCE。`code_verifier` から計算したハッシュ |
| `code_challenge_method` | `S256` (SHA-256)。この IdP は `S256` のみ対応 |

IdP は未ログインなら、ログイン画面へ送ります。実際に確かめた結果です。

```
GET /oauth2/authorize?... (Accept: text/html)
HTTP/1.1 302
Location: http://localhost:9000/login
```

(MockMvc のテストでは `Location` は相対パスの `/login` になります。実サーバーでは絶対 URL です。)

ログインが済むと、ブラウザは元の認可リクエストを再送し、IdP は `redirect_uri` に 302 で返します。

```
HTTP/1.1 302
Location: http://127.0.0.1:8080/login/oauth2/code/idp?code=uGMc7X4PMt_z1yuYXTPWN7XWHKxwf3aO2bL-vD7N...&state=xyz
```

クライアントは `state` が自分で送った値と同じことを確かめます。

### 2. トークンリクエスト

クライアントは認可コードを、IdP に**直接**持ち込みます。

```
POST /oauth2/token
Authorization: Basic d2ViLWNsaWVudDp3ZWItY2xpZW50LXNlY3JldA==
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=uGMc7X4PMt_z1yuYXTPWN7XWHKxwf3aO2bL-vD7N...
&redirect_uri=http://127.0.0.1:8080/login/oauth2/code/idp
&code_verifier=a-very-long-random-string-used-as-pkce-code-verifier-0123456789
```

| パラメーター | 役割 |
|---|---|
| `grant_type=authorization_code` | 「認可コードをトークンに交換したい」 |
| `code` | 1 で受け取った認可コード |
| `redirect_uri` | 認可リクエストに付けたものと**同じ値**。コードが別の文脈で使い回されないかの確認に使う |
| `code_verifier` | PKCE の元の乱数。IdP は `S256(code_verifier)` を保存済みの `code_challenge` と比べる |

`Authorization: Basic ...` は `client_secret_basic` によるクライアント認証です (`client_id:client_secret` を Base64 にしたもの)。成功すると次の JSON が返ります (長い値は省略)。

```json
{
  "access_token": "eyJraWQiOiI2NWQwZTE4NC01MDFi...",
  "refresh_token": "gW6v-IfVFIjsAJz7Hj1LE_bzI...",
  "scope": "openid profile",
  "id_token": "eyJraWQiOiI2NWQwZTE4NC01MDFi...",
  "token_type": "Bearer",
  "expires_in": 299
}
```

アクセストークンと ID トークンの中身 (JWT のペイロード) は次のとおりです。ID トークンに認可リクエストの `nonce` が入っていることを確認できます。トークンの詳細は 5 章で扱います。

```json
// access_token
{"sub":"user","aud":"web-client","nbf":1794303589,"scope":["openid","profile"],
 "iss":"http://localhost:9104","exp":1794303889,"iat":1794303589,"jti":"3046f51e-..."}
// id_token
{"sub":"user","aud":"web-client","azp":"web-client","auth_time":1794303588,
 "iss":"http://localhost:9104","exp":1794305389,"iat":1794303589,
 "nonce":"n-0S6_WzA2Mj","jti":"7237df50-...","sid":"BuoavwXJIZYn..."}
```

(`iss` のポート番号は実行時の 9104 のままです。9000 で動かせば 9000 になります。)

## PKCE が防ぐ攻撃と仕組み

### 認可コード横取り攻撃

認可コードは URL に載ってブラウザを通ります。スマートフォンのアプリが使うカスタム URL スキームや、ブラウザ拡張、ログ、リファラなど、攻撃者が URL を覗ける経路はあります。コードを横取りした攻撃者が、自分のクライアントからそのコードをトークンに交換できれば、ユーザーになりすませます。

confidential client なら、攻撃者は `client_secret` を知らないので交換に失敗します。しかし public client (SPA やモバイルアプリ) は秘密を持てません。そこで、「コードを取りに行った本人だけが知っている秘密」をその場で作る仕組みが PKCE です。

### 仕組み

1. クライアントが認可リクエストのたびに、乱数 `code_verifier` を作る (RFC 7636 では 43〜128 文字)。
2. `code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))` を計算し、認可リクエストで IdP に渡す。IdP は認可コードに紐づけて保存する。
3. トークンリクエストで `code_verifier` そのものを渡す。IdP が同じ計算をして、保存済みの `code_challenge` と一致したときだけトークンを出す。

横取りしたのはコードだけで、`code_verifier` はクライアントのメモリにしかありません (フロントチャネルを通るのはハッシュだけで、ハッシュから元の値は逆算できません)。だから攻撃者は交換できません。

### S256 の計算

RFC 7636 付録 B の例です。

```
code_verifier  = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
code_challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
```

Java で書くと次のとおりです。`Base64.getUrlEncoder().withoutPadding()` が肝で、通常の Base64 (`+` `/` `=`) ではなく URL セーフ版で、パディングの `=` を付けません。

`samples/ch04-authorization-code-pkce/src/test/java/com/example/idp/FlowSupport.java`

```java
    /** RFC 7636 の S256: BASE64URL(SHA256(ASCII(code_verifier))) (パディング無し)。 */
    static String s256(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        }
        catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
```

`AuthorizationCodeFlowTests` の `RFC7636付録Bの例でS256のチャレンジが計算できる` が、上の付録 B の値で固定しています。RFC には `code_challenge_method=plain` (ハッシュしない) もありますが、これはチャレンジが URL に載るため横取りに無力です。この IdP は `S256` しか受け付けません (ディスカバリの `code_challenge_methods_supported` は `["S256"]`。`plain` を送るとテストで拒否されることも確認済みです)。

## RegisteredClient の設定項目

クライアントは IdP に事前登録します。`RegisteredClient` はその 1 件分の台帳です。サンプルの `SecurityConfig` から、confidential client の登録を見ます。

`samples/ch04-authorization-code-pkce/src/main/java/com/example/idp/config/SecurityConfig.java`

```java
        RegisteredClient webClient = RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("web-client")
            // 学習用の固定値。本番では使わない
            .clientSecret(passwordEncoder.encode("web-client-secret"))
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            // redirect_uri は登録値との完全一致で検証される
            .redirectUri("http://127.0.0.1:8080/login/oauth2/code/idp")
            .postLogoutRedirectUri("http://127.0.0.1:8080/")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .clientSettings(ClientSettings.builder()
                // confidential client でも PKCE を必須にする (OAuth 2.1 の方針)
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            // 詳細は 5 章。ここでは既定値を明示しているだけ
            .tokenSettings(TokenSettings.builder()
                .authorizationCodeTimeToLive(Duration.ofMinutes(5))
                .accessTokenTimeToLive(Duration.ofMinutes(5))
                .refreshTokenTimeToLive(Duration.ofMinutes(60))
                .build())
            .build();
```

| 項目 | 意味 |
|---|---|
| `id` | IdP 内部の主キー。UUID など。`clientId` とは別物 |
| `clientId` | OAuth のプロトコル上の識別子。リクエストの `client_id` |
| `clientSecret` | confidential client の秘密。`PasswordEncoder` でハッシュして保存する (パスワードと同じ扱い)。public client では設定しない |
| `clientAuthenticationMethod` | トークンエンドポイントでのクライアントの名乗り方。`CLIENT_SECRET_BASIC` (Authorization ヘッダー)、`CLIENT_SECRET_POST` (フォームの本文)、`NONE` (名乗るだけ。public client)、他に `private_key_jwt` など。複数登録できる |
| `authorizationGrantType` | そのクライアントに許す grant。`AUTHORIZATION_CODE` を許さないクライアントは認可コードフローを使えない。`REFRESH_TOKEN` を足すとリフレッシュトークンを使える (public client を除く。後述) |
| `redirectUri` | コードの返し先として許可する URI。**完全一致**で照合される。複数登録できる |
| `postLogoutRedirectUri` | ログアウト後に戻してよい URI。12 章で扱う。ここでは登録の形だけ見せている |
| `scope` | そのクライアントが要求してよい scope の上限。ここに無い scope は拒否される |
| `ClientSettings.requireProofKey` | `true` なら PKCE を必須にする |
| `ClientSettings.requireAuthorizationConsent` | `true` なら同意画面を出す。6 章で扱う |
| `TokenSettings` | 認可コード・アクセストークン・リフレッシュトークンの有効期限など。既定値は認可コード 5 分、アクセストークン 5 分、リフレッシュトークン 60 分、リフレッシュトークンの再利用 (`reuseRefreshTokens`) は `true`。詳細は 5 章 |

Spring Security 7 の `RegisteredClient.Builder.build()` は、認可コード grant を許し、認証方式が `NONE` だけのクライアントを public client とみなします。`ClientSettings` を指定しない場合は `requireProofKey` と `requireAuthorizationConsent` がともに `true` になります (ソースで確認)。サンプルでは意図を示すため明示しています。

## クライアントの種類

OAuth 2.0 (RFC 6749 §2.1) は、クライアントを「秘密を守れるか」で 2 種類に分けます。

| | confidential client | public client |
|---|---|---|
| 例 | サーバーサイドの Web アプリ、バッチ | SPA、モバイルアプリ |
| 秘密 (`client_secret`) | 持てる | 持てない (ブラウザやアプリに入れた時点で見える) |
| `clientAuthenticationMethod` | `CLIENT_SECRET_BASIC` など | `NONE` |
| PKCE | 推奨 (この教材では必須にする) | **必須** (唯一の防御線) |
| トークンリクエストで送るもの | クライアント認証 + `code_verifier` | `client_id` + `code_verifier` |

サンプルには public client を 1 件足してあります。

`samples/ch04-authorization-code-pkce/src/main/java/com/example/idp/config/SecurityConfig.java`

```java
        RegisteredClient spaClient = RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("spa-client")
            // public client は秘密を持たないので、クライアント認証は NONE。clientSecret も設定しない
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://127.0.0.1:5173/callback")
            .postLogoutRedirectUri("http://127.0.0.1:5173/")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .clientSettings(ClientSettings.builder()
                // public client では PKCE が唯一の防御なので必須にする (NONE のとき実際に強制もされる)
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            .build();
```

public client のトークンリクエストには `Authorization` ヘッダーも `client_secret` も無く、`client_id` と `code_verifier` だけを送ります (`client_id=spa-client&grant_type=authorization_code&code=...&redirect_uri=http://127.0.0.1:5173/callback&code_verifier=...`)。IdP は `code_verifier` が PKCE の検証を通ることを、クライアント認証の代わりにします。

### public client にリフレッシュトークンは出るか

`spa-client` には `REFRESH_TOKEN` grant を登録していますが、**認可コードの交換でリフレッシュトークンは返りません**。実際の応答 (長い値は省略) です。

```json
{"access_token":"eyJraWQiOiI2NWQwZTE4NC01M...","scope":"openid profile","id_token":"eyJraWQiOiI2NWQwZTE4NC01M...","token_type":"Bearer","expires_in":299}
```

`refresh_token` がありません。`OAuth2RefreshTokenGenerator` のソースに「Do not issue refresh token to public client」とあり、認可コード grant でクライアント認証方式が `NONE` のときは `null` を返しています。理由は、秘密を持たない public client のリフレッシュトークンは盗まれたときに本人確認の手段が無く、長期間使えてしまうためです。`AuthorizationCodeFlowTests` の `publicクライアントにはREFRESH_TOKENを登録していてもリフレッシュトークンは発行されない` が固定しています。SPA は、アクセストークンが切れたら認可コードフローをやり直します。

## 認可コードの内部: OAuth2Authorization の状態遷移

IdP は認可コードフローの進行を `OAuth2Authorization` 1 件にまとめて管理します。これを保管するのが `OAuth2AuthorizationService` です。サンプルでは、テストから中身を覗けるよう Bean として公開しています (永続化の実装に差し替えるのは 7 章)。

`samples/ch04-authorization-code-pkce/src/main/java/com/example/idp/config/SecurityConfig.java`

```java
    @Bean
    OAuth2AuthorizationService authorizationService() {
        return new InMemoryOAuth2AuthorizationService();
    }
```

テスト `認可リクエストからトークン発行までOAuth2Authorizationの中身が遷移する` で、2 つの時点の中身を確かめています。

**時点 1: コード発行直後** (認可リクエストが成功した直後)

`samples/ch04-authorization-code-pkce/src/test/java/com/example/idp/AuthorizationCodeFlowTests.java`

```java
        OAuth2Authorization issued = authorizationService.findByToken(code, CODE);
        assertThat(issued.getPrincipalName()).isEqualTo("user");
        assertThat(issued.getAuthorizedScopes()).containsExactlyInAnyOrder("openid", "profile");
        assertThat(issued.getAccessToken()).isNull();
        assertThat(issued.getRefreshToken()).isNull();
        assertThat(issued.getToken(OidcIdToken.class)).isNull();

        OAuth2AuthorizationRequest saved = issued.getAttribute(OAuth2AuthorizationRequest.class.getName());
        assertThat(saved.getState()).isEqualTo("xyz");
        assertThat(saved.getRedirectUri()).isEqualTo(WEB_REDIRECT);
        assertThat(saved.getAdditionalParameters())
            .containsEntry("code_challenge", s256(VERIFIER))
            .containsEntry("code_challenge_method", "S256")
            .containsEntry("nonce", "n-0S6_WzA2Mj");
```

- 保存されているのは、認可リクエストの内容 (`OAuth2AuthorizationRequest`。`state`、`redirect_uri`、`code_challenge`、`nonce` を含む)、認証済みユーザー (`Principal` 属性と `principalName`)、許可された scope、そして認可コードだけです。トークンはまだありません。
- `code_challenge` を保管しているので、あとでトークンリクエストの `code_verifier` と照合できます。
- 認可コードトークンのメタデータは `invalidated=false` で、有効期限は発行から 5 分です (`TokenSettings.authorizationCodeTimeToLive`)。

**時点 2: トークン発行後**

```java
        OAuth2Authorization completed = authorizationService.findByToken(code, CODE);
        assertThat(completed.getId()).isEqualTo(issued.getId());
        assertThat(completed.getToken(OAuth2AuthorizationCode.class).isInvalidated()).isTrue();
        assertThat(completed.getAccessToken().isActive()).isTrue();
        assertThat(completed.getRefreshToken().isActive()).isTrue();
        assertThat(completed.getToken(OidcIdToken.class)).isNotNull();
```

- `id` は同じです。つまり新しい Authorization を作るのではなく、**同じ 1 件にトークンが足されます**。
- 認可コードは `invalidated=true` になります。レコードは消えず「使用済み」の印が付くので、後から再利用を検知できます (これが次節の仕組みの土台です)。

認可コードが「1 回限り」で「短命」である理由は、フロントチャネルを通る値だからです。万一漏れても、使える時間と回数を絞って被害を小さくします。

期限切れは 5 分待たずに確かめます。保存済みの認可コードを、期限が過去の `OAuth2AuthorizationCode` に差し替えるテストです。

```java
        OAuth2Authorization authorization = authorizationService.findByToken(code, CODE);
        Instant past = Instant.now().minus(Duration.ofMinutes(10));
        OAuth2AuthorizationCode expired = new OAuth2AuthorizationCode(code, past, past.plus(Duration.ofMinutes(5)));
        authorizationService.save(OAuth2Authorization.from(authorization).token(expired).build());

        exchange("web-client", "web-client-secret", code, WEB_REDIRECT)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
```

## 失敗ケースと実際のレスポンス

失敗ケースは、**誰に返すか**で 2 系統に分かれます。

- 認可エンドポイント (ブラウザ経由): `redirect_uri` が信用できるなら、そこへ `error` パラメーター付きで 302 する。信用できないなら、リダイレクトせず IdP 自身がエラーを表示する。
- トークンエンドポイント (クライアントとの直接通信): HTTP ステータスと JSON `{"error": "..."}` で返す。

以下の出力はすべて実際に起動して確かめたもの (ポートは 9000 に置き換え) で、`FailureCaseTests` が各ケースを固定しています。

### redirect_uri が登録値と違う: リダイレクトしない

```
GET /oauth2/authorize?response_type=code&client_id=web-client&redirect_uri=http://evil.example/cb&scope=openid&code_challenge=...&code_challenge_method=S256
HTTP/1.1 400
Content-Type: text/html;charset=UTF-8

<html><body><h1>Whitelabel Error Page</h1><p>This application has no explicit mapping for /error, ...
There was an unexpected error (type=Bad Request, status=400).</div></body></html>
```

`Location` ヘッダーはありません。`redirect_uri` が登録値かどうか検証できない状態で、そこへエラーを返すと、攻撃者が指定した URL へユーザーを飛ばす中継 (オープンリダイレクト) になってしまうためです (RFC 6749 §4.1.2.1)。未登録の `client_id` でも同じです。

`redirect_uri` の照合は完全一致です。末尾に `/` を足した、クエリ (`?x=1`) を付けた、パスが短いといった違いでもすべて 400 になります (`redirect_uriは前方一致や末尾スラッシュの違いでも拒否される`)。なお Whitelabel 画面は Spring Boot の既定のエラーページで、本番では専用のエラー画面を用意します。

#### 未ログインだと 400 ではなく /login への 302 になる

上の 400 のエラーページは、**ログイン済みのブラウザの場合**の結果です。同じ登録外の `redirect_uri` でも、未ログインだと次のようになります。

```
GET /oauth2/authorize?...&redirect_uri=http://evil.example/cb&...  (Cookie なし, Accept: text/html)
HTTP/1.1 302
Location: http://localhost:9000/login;jsessionid=...
```

IdP は 400 を返す際、エラーページを `/error` で描画します。`/error` は 2 本目のフィルターチェーン (`defaultSecurityFilterChain`) の管轄で「認証必須」のため、未ログインでは描画の前に `/login` へ送られます。つまり「ログイン画面が出たから、認可リクエストは正しい」とは言えません。ログインしてから初めて、redirect_uri 不一致などのエラーが見えます。(`Location` の `;jsessionid=...` は、Cookie を持たないクライアントに付く URL 書き換えです。)

この 2 つの場合分けは、実サーバーをランダムポートで起動する `ErrorPageDispatchTests` が固定しています。なお `FailureCaseTests` が使う MockMvc はエラーページへの内部転送 (エラーディスパッチ) をしないため、確かめられるのは「ログイン済みで 400 が返り、`Location` が無い」までです。この章のほかの認可エンドポイントのテストはすべて、ログイン済み (`formLogin()` 後のセッション付き) の状態で確かめています。

### 登録していない scope: error 付きでリダイレクト

```
GET /oauth2/authorize?...&scope=openid%20admin&state=xyz&...
HTTP/1.1 302
Location: http://127.0.0.1:8080/login/oauth2/code/idp?error=invalid_scope&error_description=OAuth%202.0%20Parameter%3A%20scope&error_uri=https%3A%2F%2Fdatatracker.ietf.org%2Fdoc%2Fhtml%2Frfc6749%23section-4.1.2.1&state=xyz
```

`redirect_uri` は検証済みなので、クライアントへエラーを返せます。`state` も付くので、クライアントは自分のリクエストの結果だと照合できます。`error_description` は `scope` パラメーターが原因だと示すだけで、どの scope かは示しません。

### PKCE 必須なのに code_challenge が無い

```
GET /oauth2/authorize?response_type=code&client_id=web-client&redirect_uri=...&scope=openid&state=xyz
HTTP/1.1 302
Location: http://127.0.0.1:8080/login/oauth2/code/idp?error=invalid_request&error_description=OAuth%202.0%20Parameter%3A%20code_challenge&error_uri=https%3A%2F%2Fdatatracker.ietf.org%2Fdoc%2Fhtml%2Frfc7636%23section-4.4.1&state=xyz
```

`web-client` (confidential) も `spa-client` (public) も、`requireProofKey=true` なので同じ結果です。`error_uri` が RFC 7636 §4.4.1 を指します。認可リクエストの段階で拒否するので、PKCE を使わないクライアントは認可コードすら受け取れません。

### code_verifier が一致しない

```
POST /oauth2/token  (grant_type=authorization_code&...&code_verifier=wrong-verifier-wrong-...)
HTTP/1.1 400
Content-Type: application/json;charset=UTF-8

{"error":"invalid_grant"}
```

`invalid_grant` (認可コードや redirect_uri、code_verifier など、「渡された許可の証拠」が無効) です。このとき認可コードは**消費されません**。間違った `code_verifier` を送っても、その後に正しい値で交換できます (`code_verifier を間違えても認可コードは消費されず正しい値で再挑戦できる`)。横取りした攻撃者が失敗を繰り返しても、正規のクライアントの邪魔にならない代わりに、攻撃者の試行回数を IdP 側では絞っていない点には注意してください。256 ビット級の `code_verifier` を推測できないことが防御の根拠です。

public client が `code_verifier` 自体を送らなかった場合は少し違います。public client は `code_verifier` の有無でクライアント認証の対象かどうかが決まるため、無いと「クライアントを特定できない未認証のリクエスト」になります。`Accept: application/json` なら `401`、`Accept` を付けないと `/login` への 302 になります (どちらも実行して確認)。

### redirect_uri がトークンリクエストで違う

認可リクエストと別の値を送ると `400 {"error":"invalid_grant"}` です (RFC 6749 §4.1.3)。

### client 認証の失敗

```
POST /oauth2/token  (Authorization: Basic web-client:nope)
HTTP/1.1 401
{"error":"invalid_client"}
```

こちらは `401` で、`invalid_client` です。public client が `client_secret` を付けて送ってきた場合も、登録された認証方式が `NONE` なので `401 invalid_client` になります。

### 認可コードの再利用

1 回目は成功し、同じコードでもう一度送ると次のとおりです。

```
POST /oauth2/token  (1 回目と同じパラメーター)
HTTP/1.1 400
{"error":"invalid_grant"}
```

IdP のログには次の警告が出ます。

```
WARN ... OAuth2AuthorizationCodeAuthenticationProvider : Invalidated authorization token(s) previously issued to registered client '...'
```

応答は単なる `invalid_grant` ですが、内部で**1 回目に発行したトークンも無効化されます**。`OAuth2Authorization` を見ると、リフレッシュトークンとアクセストークンの両方が `invalidated=true` に変わっています。使用済みのコードがもう一度来た、ということは「コードが横取りされ、攻撃者と正規のクライアントのどちらかが先にトークンを得ている」可能性があり、どちらが本物か区別できないので、RFC 6749 §4.1.2 の推奨どおり発行済みトークンを失効させる、という安全側の設計です。

実際に、再利用のあとで 1 回目のリフレッシュトークンを `grant_type=refresh_token` で使うと、`400 {"error":"invalid_grant"}` になります。

ここまでの `invalidated` が付く場面をまとめます。

| 場面 | コード | 発行済みトークン |
|---|---|---|
| コード発行後、1 回目の交換が成功 | 無効 (使用済み) | 有効 |
| 同じコードの再利用 | 無効のまま | **無効化される** |
| 別のクライアントが使おうとする | **無効化される** | (まだ無い) |
| code_verifier が違う | 有効のまま | (まだ無い) |

「別のクライアントが使おうとした」場合は、`spa-client` が `web-client` 宛てのコードを送るテストで、`400 invalid_grant` になり、そのあと正規の `web-client` も交換できなくなることを確認しています。

## リフレッシュトークンによる更新

アクセストークンは 5 分で切れます。そのたびにユーザーに再ログインさせないための仕組みがリフレッシュトークンです。クライアントは `grant_type=refresh_token` でトークンエンドポイントを呼びます。

```
POST /oauth2/token
Authorization: Basic d2ViLWNsaWVudDp3ZWItY2xpZW50LXNlY3JldA==

grant_type=refresh_token&refresh_token=gW6v-IfVFIjsAJz7Hj1LE_bzI...
```

応答は認可コード交換と同じ形の JSON です。新しいアクセストークンと ID トークンが出ます。`refresh_token` は**入れ替わらず、前回と同じ値**が返りました。`TokenSettings.reuseRefreshTokens` の既定が `true` だからです (`false` にすると毎回新しいリフレッシュトークンに入れ替わる「ローテーション」になります。`false` の挙動は 5 章で実際に確かめます)。

`scope` パラメーターの扱いは次のとおりで、すべてテストで確認しました。

| リフレッシュ時の `scope` | 結果 |
|---|---|
| 省略 | 元の認可の scope (`openid profile`) が引き継がれる |
| 元より狭い (`openid`) | 200。応答の `scope` は `openid` だけになる |
| 元より広い (`openid profile email`) | `400 {"error":"invalid_scope"}` |

「元の認可に含まれない scope は要求できない」という規則です (RFC 6749 §6)。狭めた場合に、保存された認可 (`OAuth2Authorization`) 側の scope がどうなるかは、この章では確かめていません (未検証)。

テストは `リフレッシュトークンで新しいアクセストークンを取得できる` と、scope の 3 件 (`リフレッシュ時にscopeを…`) です。

confidential client のみがリフレッシュトークンを受け取れる (public client には出ない) 点は、前の節で見たとおりです。

## 動作確認

```bash
cd samples/ch04-authorization-code-pkce
mvn test
```

```
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0 -- in com.example.idp.IdpApplicationTests
[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0 -- in com.example.idp.ErrorPageDispatchTests
[INFO] Tests run: 11, Failures: 0, Errors: 0, Skipped: 0 -- in com.example.idp.AuthorizationCodeFlowTests
[INFO] Tests run: 15, Failures: 0, Errors: 0, Skipped: 0 -- in com.example.idp.FailureCaseTests
[INFO] Tests run: 31, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

起動して curl で追う場合は、ログインして Cookie を得てから `/oauth2/authorize` を叩き、`Location` の `code` を `/oauth2/token` に渡します。`code_challenge` は `printf %s $V | openssl dgst -sha256 -binary | basenc --base64url | tr -d '='` で作れ、本文の例の `HJBdpkC_B-Mnzm5aPbGvpAlCHyaap_U6w6hg37BvXWA` と一致します。この章の出力は、この手順を別ポートで実行して得ました。

## つまずきポイント

**症状**: 認可リクエストが「Whitelabel Error Page」の 400 になり、`redirect_uri` に戻ってこない。あるいは、エラーのはずがログイン画面が出て、ログイン後に初めて 400 になる。
**原因**: `redirect_uri` が登録値と 1 文字でも違う (`localhost` と `127.0.0.1`、末尾の `/`、ポート、`http` と `https`)。IdP は検証できない宛先にはエラーも返さない。
**対処**: `RegisteredClient.redirectUri` とクライアント側の設定を文字列で突き合わせる。`localhost` と `127.0.0.1` は別物として扱われる。未ログインだとエラーページの代わりに `/login` へ送られるため、ログイン画面が出ても安心せず、ログイン後のエラーも確認する。

**症状**: PKCE のパラメーターを付けたのに `invalid_request` (`code_challenge`)。
**原因**: `code_challenge_method` を省略した、`plain` にした、のどちらか。この IdP は `S256` のみ。
**対処**: `code_challenge_method=S256` を必ず付ける。

**症状**: `invalid_grant` としか返らず、原因が分からない。
**原因**: コードの期限切れ、再利用、`redirect_uri` 違い、`code_verifier` 違いが、同じ `invalid_grant` に畳まれる。攻撃者にヒントを与えないための仕様。
**対処**: IdP 側のログ (`org.springframework.security` を DEBUG にする) で、どの検証に落ちたかを見る。

**症状**: public client にリフレッシュトークンが返らない。
**原因**: 仕様どおり。`REFRESH_TOKEN` grant を登録していても、認可コード grant かつ認証方式 `NONE` では発行されない。
**対処**: アクセストークンの期限切れ時は認可コードフローをやり直す。長期のセッションが要るなら、バックエンド付きの confidential client (BFF) にする。

## まとめ

- 認可コードフローは、ブラウザ経由のフロントチャネルで「使い捨てのコード」を運び、バックチャネルでトークンに交換する。トークンはブラウザに出ない。
- PKCE は `S256(code_verifier)` を先に渡しておき、交換時に `code_verifier` を示させることで、コードを横取りした第三者が交換できないようにする。public client では必須で、この教材では confidential client でも必須にしている。
- `RegisteredClient` は clientId / 認証方式 / grant / redirectUri (完全一致) / scope と、`ClientSettings` / `TokenSettings` で構成する。public client は認証方式 `NONE` で秘密を持たない。
- 失敗の返し方は 2 系統。`redirect_uri` が検証できない場合はリダイレクトせず IdP が 400 を表示し、トークンエンドポイントは `invalid_grant` (400) か `invalid_client` (401) の JSON を返す。
- 認可コードは 5 分・1 回限り。使用後は `invalidated` の印が付き、再利用されると発行済みトークンも無効化される。コードからトークンまで、同じ `OAuth2Authorization` に状態が足されていく。
- public client にはリフレッシュトークンが発行されない。confidential client は `grant_type=refresh_token` で更新でき、既定ではリフレッシュトークンの値は入れ替わらない。

## 次の章へ

この章ではトークンを「取得できた」ところまでを扱い、中身はほとんど見ませんでした。次の 5 章では、アクセストークン (JWT) と ID トークンのクレームの意味、署名の検証、有効期限や `reuseRefreshTokens` といった `TokenSettings` を詳しく見ます。
