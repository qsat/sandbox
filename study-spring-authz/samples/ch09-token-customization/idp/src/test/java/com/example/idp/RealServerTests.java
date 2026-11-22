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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 実際にサーバーを起動 (ランダムポート) して確かめるテスト。
 *
 * <p>MockMvc はエラーページ (/error) への内部転送 (エラーディスパッチ) も、
 * サーバーのセッション Cookie 設定 (server.servlet.session.cookie.name) も再現しない。
 * これらは実サーバーでないと確かめられない。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RealServerTests {

    private static final String EVIL = "http://evil.example/cb";

    @LocalServerPort
    int port;

    // リダイレクトは自動で追わず、IdP が返した生の応答を見る
    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

    @Test
    void 未ログインでも登録外のredirect_uriはログイン画面ではなくエラーページの400になる() throws Exception {
        HttpResponse<String> response = http.send(authorize(null), BodyHandlers.ofString());

        // /error を permitAll にしてあるので、400 のエラーページがそのまま見える。
        // permitAll にしていないと、/error が認証必須になって /login への 302 に化ける (4 章)
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.headers().firstValue("Location")).isEmpty();
        assertThat(response.body()).contains("リクエストを処理できませんでした").doesNotContain("Whitelabel");
    }

    @Test
    void ログイン済みでも登録外のredirect_uriは同じ400のエラーページになる() throws Exception {
        HttpResponse<String> response = http.send(authorize(login()), BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.body()).contains("リクエストを処理できませんでした").contains("400");
    }

    @Test
    void セッションCookieの名前はJSESSIONIDではなくIDP_SESSIONになる() throws Exception {
        HttpResponse<String> page = http.send(
            HttpRequest.newBuilder(URI.create(base() + "/login")).build(), BodyHandlers.ofString());

        List<String> cookies = page.headers().allValues("Set-Cookie");
        assertThat(cookies).anyMatch(c -> c.startsWith("IDP_SESSION="));
        assertThat(cookies).noneMatch(c -> c.startsWith("JSESSIONID="));
    }

    @Test
    void 直接ログインするとIdPのホーム画面に着きログイン中のユーザーが表示される() throws Exception {
        String cookie = login();

        HttpResponse<String> home = http.send(HttpRequest.newBuilder(URI.create(base() + "/"))
            .header("Cookie", cookie).build(), BodyHandlers.ofString());

        assertThat(home.statusCode()).isEqualTo(200);
        assertThat(home.body()).contains("Alice Example").contains("alice");
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

    /** /login から CSRF トークンを取り、フォームログインして IDP_SESSION を返す。 */
    private String login() throws Exception {
        HttpResponse<String> page = http.send(
            HttpRequest.newBuilder(URI.create(base() + "/login")).build(), BodyHandlers.ofString());
        Matcher csrf = Pattern.compile("name=\"_csrf\"[^>]*value=\"([^\"]+)\"").matcher(page.body());
        assertThat(csrf.find()).as("ログイン画面に CSRF トークンがある").isTrue();
        String cookie = sessionCookie(page.headers().allValues("Set-Cookie"));

        HttpResponse<String> result = http.send(HttpRequest.newBuilder(URI.create(base() + "/login"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Cookie", cookie)
            .POST(HttpRequest.BodyPublishers.ofString("username=alice&password=password&_csrf=" + csrf.group(1)))
            .build(), BodyHandlers.ofString());
        // ログイン成功でセッション ID が付け替えられる
        return sessionCookie(result.headers().allValues("Set-Cookie"));
    }

    private static String sessionCookie(List<String> setCookies) {
        return setCookies.stream().filter(c -> c.startsWith("IDP_SESSION=")).findFirst().orElseThrow()
            .split(";")[0];
    }

    private String base() {
        return "http://localhost:" + port;
    }
}
