package com.example.client.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.client.OAuth2ClientHttpRequestInterceptor;
import org.springframework.web.client.RestClient;

/** リソースサーバーを呼ぶ RestClient。アクセストークンの付与と、期限切れ時の更新は OAuth2AuthorizedClientManager が行う。 */
@Configuration
public class ResourceServerClientConfig {

    /**
     * 認可済みクライアント (アクセストークンとリフレッシュトークン) の管理者。
     * refreshToken() を入れておくと、アクセストークンの期限が近いとき (既定で 60 秒前から)
     * リフレッシュトークンで自動的に更新する。
     */
    @Bean
    OAuth2AuthorizedClientManager authorizedClientManager(ClientRegistrationRepository registrations,
            OAuth2AuthorizedClientRepository authorizedClients) {
        DefaultOAuth2AuthorizedClientManager manager =
            new DefaultOAuth2AuthorizedClientManager(registrations, authorizedClients);
        manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder()
            .authorizationCode()
            .refreshToken()
            .build());
        return manager;
    }

    @Bean
    RestClient resourceServerClient(OAuth2AuthorizedClientManager manager,
            @Value("${resource-server.base-url}") String baseUrl) {
        OAuth2ClientHttpRequestInterceptor interceptor = new OAuth2ClientHttpRequestInterceptor(manager);
        // どのクライアント登録 (application.yml の idp) のトークンを付けるか
        interceptor.setClientRegistrationIdResolver(request -> "idp");
        return RestClient.builder().baseUrl(baseUrl).requestInterceptor(interceptor).build();
    }
}
