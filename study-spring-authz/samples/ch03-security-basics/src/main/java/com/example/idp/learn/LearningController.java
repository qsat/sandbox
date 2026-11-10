package com.example.idp.learn;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 【学習用エンドポイント】本番の IdP には置かない。
 *
 * <p>「いまのリクエストの Authentication」と「HttpSession に何が入っているか」を JSON で見せる。
 * 認証・セッション・SecurityContext の関係を、自分で curl して観察するためのもの。
 * セッション ID は漏れると乗っ取りに使えるため、値そのものではなく先頭 6 文字だけ返す。
 */
@RestController
class LearningController {

    private final FilterChainInspector inspector;

    LearningController(FilterChainInspector inspector) {
        this.inspector = inspector;
    }

    /** 現在の Authentication と HttpSession の中身。 */
    @GetMapping("/learn/security-context")
    Map<String, Object> securityContext(HttpServletRequest request) {
        Map<String, Object> body = new LinkedHashMap<>();

        // SecurityContextHolder (= いまのスレッドに結び付いた SecurityContext)
        SecurityContext context = SecurityContextHolder.getContext();
        Authentication authentication = context.getAuthentication();
        Map<String, Object> auth = new LinkedHashMap<>();
        auth.put("type", authentication.getClass().getSimpleName());
        auth.put("name", authentication.getName());
        auth.put("authenticated", authentication.isAuthenticated());
        auth.put("principalType", authentication.getPrincipal().getClass().getSimpleName());
        auth.put("authorities", authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority).sorted().toList());
        body.put("authentication", auth);

        // HttpSession (getSession(false): 観察のためにセッションを新規作成しない)
        HttpSession session = request.getSession(false);
        Map<String, Object> sessionInfo = new LinkedHashMap<>();
        sessionInfo.put("exists", session != null);
        if (session != null) {
            sessionInfo.put("idPrefix", session.getId().substring(0, Math.min(6, session.getId().length())));
            Map<String, String> attributes = new LinkedHashMap<>();
            List<String> names = Collections.list(session.getAttributeNames());
            for (String name : names.stream().sorted().toList()) {
                attributes.put(name, session.getAttribute(name).getClass().getSimpleName());
            }
            sessionInfo.put("attributes", attributes);
        }
        body.put("session", sessionInfo);
        return body;
    }

    /** SecurityFilterChain ごとのフィルター一覧。 */
    @GetMapping("/learn/filters")
    List<FilterChainInspector.ChainInfo> filters() {
        return inspector.describe();
    }

    /** 認可の観察用: ROLE_ADMIN を持つユーザーだけが通れる (SecurityConfig で設定)。 */
    @GetMapping("/learn/admin")
    Map<String, String> admin() {
        return Map.of("message", "ADMIN only");
    }
}
