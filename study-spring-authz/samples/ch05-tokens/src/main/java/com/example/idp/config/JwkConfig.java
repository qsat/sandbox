package com.example.idp.config;

import java.io.InputStream;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;

/**
 * 署名鍵の定義。
 *
 * <p>JWKSource Bean を自分で定義すると、Spring Boot の自動設定 (起動のたびに鍵を作り直す) は使われなくなる。
 * 鍵を固定しておけば、再起動しても発行済みトークンの署名を検証できる。
 */
@Configuration
public class JwkConfig {

    /** /oauth2/jwks に出る kid。鍵を入れ替えるときに「どの鍵で署名したか」を見分ける目印。 */
    static final String KEY_ID = "study-key-1";

    /**
     * 学習用の固定鍵を classpath の PEM から読む。
     * 注意: keys/study-only-rsa-private.pem はリポジトリで公開されている。本番では絶対に使わないこと。
     */
    @Bean
    JWKSource<SecurityContext> jwkSource() throws Exception {
        RSAPrivateCrtKey privateKey = readPrivateKey(new ClassPathResource("keys/study-only-rsa-private.pem"));
        // CRT 形式の秘密鍵には公開指数が入っているので、公開鍵は秘密鍵から復元できる
        RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA")
            .generatePublic(new RSAPublicKeySpec(privateKey.getModulus(), privateKey.getPublicExponent()));

        RSAKey rsaKey = new RSAKey.Builder(publicKey)
            .privateKey(privateKey)
            .keyID(KEY_ID)
            .build();
        return new ImmutableJWKSet<>(new JWKSet(rsaKey));
    }

    private static RSAPrivateCrtKey readPrivateKey(Resource resource) throws Exception {
        String pem;
        try (InputStream in = resource.getInputStream()) {
            pem = new String(in.readAllBytes());
        }
        String base64 = pem.replaceAll("-----(BEGIN|END) PRIVATE KEY-----", "").replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(base64);
        return (RSAPrivateCrtKey) KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }
}
