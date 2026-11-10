package com.example.idp.token;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import com.example.idp.user.UserAccount;
import com.example.idp.user.UserAccountRepository;

import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.core.oidc.OidcUserInfo;
import org.springframework.security.oauth2.core.oidc.StandardClaimNames;
import org.springframework.security.oauth2.server.authorization.oidc.authentication.OidcUserInfoAuthenticationContext;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;

/**
 * 「どの scope のときに UserAccount のどの属性をクレームとして出すか」を 1 か所に集めたもの。
 *
 * <p>ID トークンと UserInfo が同じ規則を使うようにするため、規則は {@link #claimsFor} だけに置く
 * (OpenID Connect Core 1.0 の 5.4 節: scope と標準クレームの対応)。
 */
public class ScopedClaims {

    private final UserAccountRepository repository;

    public ScopedClaims(UserAccountRepository repository) {
        this.repository = repository;
    }

    /** scope に応じた標準クレームを作る。sub はここでは扱わない。 */
    Map<String, Object> claimsFor(UserAccount account, Set<String> scopes) {
        Map<String, Object> claims = new LinkedHashMap<>();
        if (scopes.contains(OidcScopes.PROFILE)) {
            claims.put(StandardClaimNames.NAME, account.displayName());
            claims.put(StandardClaimNames.PREFERRED_USERNAME, account.username());
        }
        if (scopes.contains(OidcScopes.EMAIL)) {
            claims.put(StandardClaimNames.EMAIL, account.email());
            claims.put(StandardClaimNames.EMAIL_VERIFIED, account.emailVerified());
        }
        return claims;
    }

    /** ID トークンに載せるクレームを足す。アクセストークンやリフレッシュトークンには触らない。 */
    public OAuth2TokenCustomizer<JwtEncodingContext> idTokenCustomizer() {
        return context -> {
            if (!"id_token".equals(context.getTokenType().getValue())) {
                return;
            }
            // 同意されて承認された scope だけで判断する (クライアントが要求しただけの scope は含まれない)
            Set<String> authorizedScopes = context.getAuthorizedScopes();
            repository.findByUsername(context.getPrincipal().getName()).ifPresent(account ->
                context.getClaims().claims(claims -> claims.putAll(claimsFor(account, authorizedScopes))));
        };
    }

    /** /userinfo の応答を作る。アクセストークンに紐づく scope で出し分ける。 */
    public Function<OidcUserInfoAuthenticationContext, OidcUserInfo> userInfoMapper() {
        return context -> {
            String username = context.getAuthorization().getPrincipalName();
            UserAccount account = repository.findByUsername(username)
                .orElseThrow(() -> new OAuth2AuthenticationException(OAuth2ErrorCodes.INVALID_TOKEN));
            Map<String, Object> claims = new LinkedHashMap<>();
            // sub は必須クレームで、ID トークンの sub と一致していなければならない
            claims.put(StandardClaimNames.SUB, username);
            claims.putAll(claimsFor(account, context.getAccessToken().getScopes()));
            return new OidcUserInfo(claims);
        };
    }
}
