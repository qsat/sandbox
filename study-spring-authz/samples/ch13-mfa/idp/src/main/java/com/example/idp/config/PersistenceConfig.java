package com.example.idp.config;

import com.example.idp.user.UserAccountDetails;
import com.example.idp.user.UserAccountDetailsMixin;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.lob.DefaultLobHandler;
import org.springframework.security.jackson.SecurityJacksonModules;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService.JsonMapperOAuth2AuthorizationParametersMapper;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService.JsonMapperOAuth2AuthorizationRowMapper;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.JdbcRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.jsontype.BasicPolymorphicTypeValidator;

/** 7 章: クライアント・認可・同意の保管庫を JDBC 実装にする。8 章で、独自の UserDetails を保存できるようにした。 */
@Configuration
public class PersistenceConfig {

    /** クライアントの台帳 (oauth2_registered_client)。初期データは DataSeeder が入れる。 */
    @Bean
    RegisteredClientRepository registeredClientRepository(JdbcTemplate jdbcTemplate) {
        return new JdbcRegisteredClientRepository(jdbcTemplate);
    }

    /**
     * 認可 (発行済みコード・トークン) の保管庫 (oauth2_authorization)。
     *
     * <p>認可の attributes にはログイン中のユーザー (UserAccountDetails) が入る。
     * 標準の設定のままだと、保存はできても読み戻しで失敗する (トークンエンドポイントが 500 になる)。
     * 許可リストに UserAccountDetails を足した JsonMapper を、読みと書きの両方に渡す。
     */
    @Bean
    OAuth2AuthorizationService authorizationService(JdbcTemplate jdbcTemplate,
            RegisteredClientRepository registeredClientRepository) {
        JsonMapper mapper = JsonMapper.builder()
            .addModules(SecurityJacksonModules.getModules(getClass().getClassLoader(),
                // 型を 1 つずつ明示する。パッケージ丸ごとの許可は、許可リストの意味を弱める
                BasicPolymorphicTypeValidator.builder().allowIfSubType(UserAccountDetails.class)))
            .addMixIn(UserAccountDetails.class, UserAccountDetailsMixin.class)
            .build();

        JdbcOAuth2AuthorizationService service =
            new JdbcOAuth2AuthorizationService(jdbcTemplate, registeredClientRepository);
        JsonMapperOAuth2AuthorizationRowMapper rowMapper =
            new JsonMapperOAuth2AuthorizationRowMapper(registeredClientRepository, mapper);
        // 自前で RowMapper を作ると LobHandler が設定されない。忘れると BLOB 列が読めない
        rowMapper.setLobHandler(new DefaultLobHandler());
        service.setAuthorizationRowMapper(rowMapper);
        service.setAuthorizationParametersMapper(new JsonMapperOAuth2AuthorizationParametersMapper(mapper));
        return service;
    }

    /** 同意の保管庫 (oauth2_authorization_consent)。 */
    @Bean
    OAuth2AuthorizationConsentService authorizationConsentService(JdbcTemplate jdbcTemplate,
            RegisteredClientRepository registeredClientRepository) {
        return new JdbcOAuth2AuthorizationConsentService(jdbcTemplate, registeredClientRepository);
    }
}
