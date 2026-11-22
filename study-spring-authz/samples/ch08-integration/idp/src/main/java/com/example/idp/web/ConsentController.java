package com.example.idp.web;

import java.security.Principal;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsent;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 同意画面。認可サーバーが「同意が必要」と判断したときに、ブラウザをここへリダイレクトしてくる。
 *
 * <p>受け取るのは client_id / scope (空白区切り) / state の 3 つだけ。
 * ここで表示するのは見た目のための情報で、「何に同意できるか」の最終判断は
 * 認可サーバーが state から引いた元の認可リクエストと突き合わせて行う。
 * (scope を改ざんして送っても、元のリクエストに無い scope は invalid_scope になる)
 */
@Controller
class ConsentController {

    /** scope の名前 → 画面に出す説明。 */
    private static final Map<String, String> SCOPE_DESCRIPTIONS = Map.of(
        OidcScopes.PROFILE, "表示名の参照",
        OidcScopes.EMAIL, "メールアドレスの参照");

    private final RegisteredClientRepository registeredClientRepository;
    private final OAuth2AuthorizationConsentService consentService;

    ConsentController(RegisteredClientRepository registeredClientRepository,
                      OAuth2AuthorizationConsentService consentService) {
        this.registeredClientRepository = registeredClientRepository;
        this.consentService = consentService;
    }

    @GetMapping("/oauth2/consent")
    String consent(Principal principal,
                   Model model,
                   @RequestParam(OAuth2ParameterNames.CLIENT_ID) String clientId,
                   @RequestParam(OAuth2ParameterNames.SCOPE) String scope,
                   @RequestParam(OAuth2ParameterNames.STATE) String state) {

        RegisteredClient client = registeredClientRepository.findByClientId(clientId);
        OAuth2AuthorizationConsent previous = (client == null) ? null
            : consentService.findById(client.getId(), principal.getName());
        Set<String> previouslyApproved = (previous == null) ? Set.of() : previous.getScopes();

        Map<String, String> toApprove = new LinkedHashMap<>();
        Map<String, String> alreadyApproved = new LinkedHashMap<>();
        for (String requested : new TreeSet<>(Arrays.asList(scope.split(" ")))) {
            // openid は同意の対象にしない (認可サーバー側も自動承認する)
            if (requested.isEmpty() || OidcScopes.OPENID.equals(requested)) {
                continue;
            }
            String description = SCOPE_DESCRIPTIONS.getOrDefault(requested, requested);
            (previouslyApproved.contains(requested) ? alreadyApproved : toApprove).put(requested, description);
        }

        model.addAttribute("clientId", clientId);
        model.addAttribute("clientName", (client != null) ? client.getClientName() : clientId);
        model.addAttribute("principalName", principal.getName());
        model.addAttribute("state", state);
        model.addAttribute("toApprove", toApprove);
        model.addAttribute("alreadyApproved", alreadyApproved);
        return "consent";
    }
}
