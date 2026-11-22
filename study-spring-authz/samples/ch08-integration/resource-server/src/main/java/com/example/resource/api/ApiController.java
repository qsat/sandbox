package com.example.resource.api;

import java.util.List;
import java.util.Map;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 小さな API。アクセストークンの中身 (sub と scope) を使って応答を作る。
 *
 * <p>ここで見ているのは、IdP が発行したアクセストークンの JWT。
 * リソースサーバーは IdP に問い合わせず、署名と中身だけで「誰の、何の権限のトークンか」を判断する。
 */
@RestController
class ApiController {

    /** 学習用のデータ。キーはユーザー (sub)。本物のリソースサーバーなら DB から引く。 */
    private static final Map<String, List<Note>> NOTES = Map.of(
        "alice", List.of(new Note(1, "ホテルのチェックイン手順"), new Note(2, "スパの予約メモ")),
        "bob", List.of(new Note(3, "朝食の時間")));

    /** トークンが誰のもので、どの scope を持つかをそのまま返す。 */
    @GetMapping("/api/me")
    Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        return Map.of(
            "sub", jwt.getSubject(),
            "scope", scopes(jwt),
            // aud は既定では client_id。リソースサーバーの識別子ではない (audience の検証は 9 章)
            "aud", jwt.getAudience(),
            "iss", jwt.getIssuer().toString());
    }

    /** 呼んだユーザーのノート。SCOPE_api.read が必要 (SecurityConfig)。sub で持ち主を絞る。 */
    @GetMapping("/api/notes")
    Map<String, Object> notes(@AuthenticationPrincipal Jwt jwt) {
        return Map.of(
            "owner", jwt.getSubject(),
            "notes", NOTES.getOrDefault(jwt.getSubject(), List.of()));
    }

    private static List<String> scopes(Jwt jwt) {
        List<String> scope = jwt.getClaimAsStringList("scope");
        return (scope == null) ? List.of() : scope;
    }

    record Note(int id, String title) {
    }
}
