package com.example.idp;

import static com.example.idp.FlowSupport.VERIFIER;
import static com.example.idp.FlowSupport.s256;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 実際にサーバーを起動 (ランダムポート) して確かめるテスト。
 *
 * <p>MockMvc はエラーページ (/error) への内部転送 (エラーディスパッチ) をしないため、
 * 「400 のエラーページが見えるか、/login に飛ばされるか」は実サーバーでないと再現できない。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ErrorPageDispatchTests {

    private static final String EVIL = "http://evil.example/cb";

    @LocalServerPort
    int port;

    // リダイレクトは自動で追わず、IdP が返した生の応答を見る
    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

    @Test
    void 未ログインだと登録外のredirect_uriでもエラーページではなくログイン画面へ302される() throws Exception {
        HttpResponse<String> response = http.send(authorize(null), BodyHandlers.ofString());

        // 400 のエラーページは /error で描画され、/error は 2 本目のチェーンで認証必須。
        // そのため未ログインのブラウザは /login へ送られる。
        // 「ログイン画面が出た」ことは、認可リクエストが正しい証拠にならない
        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(response.headers().firstValue("Location").orElseThrow()).contains("/login");
        // (Cookie を持たないクライアントには Location に ;jsessionid=... が付くことがあるので、末尾一致ではなく部分一致で見る)
    }

    @Test
    void ログイン済みだと登録外のredirect_uriは400のエラーページになる() throws Exception {
        String cookie = login();

        HttpResponse<String> response = http.send(authorize(cookie), BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.headers().firstValue("Location")).isEmpty();
        assertThat(response.body()).contains("Whitelabel Error Page");
    }

    private HttpRequest authorize(String cookie) {
        String query = "response_type=code&client_id=web-client&redirect_uri=" + EVIL
            + "&scope=openid&code_challenge=" + s256(VERIFIER) + "&code_challenge_method=S256";
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(base() + "/oauth2/authorize?" + query))
            .header("Accept", "text/html");
        if (cookie != null) {
            request.header("Cookie", cookie);
        }
        return request.build();
    }

    /** /login から CSRF トークンを取り、フォームログインして JSESSIONID を返す。 */
    private String login() throws Exception {
        HttpResponse<String> page = http.send(
            HttpRequest.newBuilder(URI.create(base() + "/login")).build(), BodyHandlers.ofString());
        String csrf = page.body().replaceAll("(?s).*name=\"_csrf\" type=\"hidden\" value=\"([^\"]+)\".*", "$1");
        String cookie = sessionCookie(page.headers().allValues("Set-Cookie"));

        HttpResponse<String> result = http.send(HttpRequest.newBuilder(URI.create(base() + "/login"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Cookie", cookie)
            .POST(HttpRequest.BodyPublishers.ofString("username=user&password=password&_csrf=" + csrf))
            .build(), BodyHandlers.ofString());
        // ログイン成功でセッション ID が付け替えられる
        return sessionCookie(result.headers().allValues("Set-Cookie"));
    }

    private static String sessionCookie(List<String> setCookies) {
        return setCookies.stream().filter(c -> c.startsWith("JSESSIONID=")).findFirst().orElseThrow()
            .split(";")[0];
    }

    private String base() {
        return "http://localhost:" + port;
    }
}
