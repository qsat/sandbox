package com.example.client.web;

import java.util.Map;
import java.util.TreeMap;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Controller
class PageController {

    private final RestClient resourceServer;
    private final OAuth2AuthorizedClientRepository authorizedClients;

    PageController(RestClient resourceServer, OAuth2AuthorizedClientRepository authorizedClients) {
        this.resourceServer = resourceServer;
        this.authorizedClients = authorizedClients;
    }

    /** ホーム。ログイン中なら ID トークンのクレームを表示する (誰がログインしたかは ID トークンが運ぶ)。 */
    @GetMapping("/")
    String home(@AuthenticationPrincipal OidcUser user, Model model) {
        if (user != null) {
            model.addAttribute("claims", new TreeMap<>(user.getIdToken().getClaims()));
        }
        return "home";
    }

    /**
     * リソースサーバーを呼ぶ。アクセストークンの付与と、期限切れ時の更新は RestClient のインターセプターがやる。
     * 呼んだあとに保存されているアクセストークンの情報も画面に出す (更新されたかを見分けるため)。
     */
    @GetMapping("/api-call")
    String apiCall(Authentication authentication, HttpServletRequest request, Model model) {
        try {
            model.addAttribute("me", resourceServer.get().uri("/api/me").retrieve().body(Map.class));
            model.addAttribute("notes", resourceServer.get().uri("/api/notes").retrieve().body(Map.class));
        }
        catch (RestClientResponseException ex) {
            model.addAttribute("error", "リソースサーバーが " + ex.getStatusCode().value() + " を返しました");
        }
        catch (RuntimeException ex) {
            model.addAttribute("error", "リソースサーバーを呼べませんでした: " + ex.getMessage());
        }
        OAuth2AuthorizedClient client = authorizedClients.loadAuthorizedClient("idp", authentication, request);
        if (client != null) {
            String token = client.getAccessToken().getTokenValue();
            model.addAttribute("tokenFingerprint", token.substring(token.length() - 8));
            model.addAttribute("tokenIssuedAt", client.getAccessToken().getIssuedAt());
            model.addAttribute("tokenExpiresAt", client.getAccessToken().getExpiresAt());
            model.addAttribute("hasRefreshToken", client.getRefreshToken() != null);
        }
        return "api-call";
    }
}
