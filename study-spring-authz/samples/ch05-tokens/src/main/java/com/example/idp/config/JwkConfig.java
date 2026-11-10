package com.example.idp.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;

/**
 * 署名鍵の定義。
 *
 * <p>JWKSource Bean を自分で定義すると、Spring Boot の自動設定 (起動のたびに鍵を作り直す) は使われなくなる。
 * 鍵をファイルに保存しておけば、再起動しても発行済みトークンの署名を検証できる。
 *
 * <p>鍵ファイルはリポジトリに置かない (.gitignore で keys/ を除外している)。初回起動時に生成する。
 * ファイルに保存するのは学習用の割り切りで、本番ではシークレット管理や KMS から鍵を取得する (応用編17章)。
 */
@Configuration
public class JwkConfig {

    private static final Logger log = LoggerFactory.getLogger(JwkConfig.class);

    @Bean
    JWKSource<SecurityContext> jwkSource(
            @Value("${idp.jwk.key-file:./keys/idp-signing-key.pem}") Path keyFile) throws Exception {
        return new ImmutableJWKSet<>(new JWKSet(loadOrCreate(keyFile)));
    }

    /** 鍵ファイルがあれば読み、無ければ RSA 2048 を生成して PKCS#8 PEM で書き出す。 */
    static RSAKey loadOrCreate(Path keyFile) throws Exception {
        RSAPrivateCrtKey privateKey;
        if (Files.exists(keyFile)) {
            privateKey = readPrivateKey(keyFile);
            log.info("署名鍵を読み込みました: {}", keyFile.toAbsolutePath());
        } else {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair keyPair = generator.generateKeyPair();
            privateKey = (RSAPrivateCrtKey) keyPair.getPrivate();
            writePrivateKey(keyFile, privateKey);
            log.info("署名鍵が無かったので新しく生成しました: {}", keyFile.toAbsolutePath());
        }
        return toRsaKey(privateKey);
    }

    private static RSAKey toRsaKey(RSAPrivateCrtKey privateKey) throws Exception {
        // CRT 形式の秘密鍵には公開指数が入っているので、公開鍵は秘密鍵から復元できる
        RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA")
            .generatePublic(new RSAPublicKeySpec(privateKey.getModulus(), privateKey.getPublicExponent()));
        RSAKey withoutKid = new RSAKey.Builder(publicKey).privateKey(privateKey).build();
        return new RSAKey.Builder(withoutKid)
            .keyID(thumbprint(withoutKid))
            .build();
    }

    /**
     * kid は鍵から導く (JWK Thumbprint、RFC 7638)。同じ鍵なら必ず同じ kid、鍵が変われば kid も変わる。
     * 固定文字列にすると、鍵だけ入れ替えて kid が同じままになる事故が起きる。
     */
    private static String thumbprint(RSAKey key) throws JOSEException {
        return key.computeThumbprint().toString();
    }

    private static RSAPrivateCrtKey readPrivateKey(Path keyFile) throws Exception {
        String pem = Files.readString(keyFile, StandardCharsets.US_ASCII);
        String base64 = pem.replaceAll("-----(BEGIN|END) PRIVATE KEY-----", "").replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(base64);
        return (RSAPrivateCrtKey) KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    private static void writePrivateKey(Path keyFile, RSAPrivateCrtKey privateKey) throws IOException {
        String body = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
            .encodeToString(privateKey.getEncoded());
        String pem = "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----\n";
        Path parent = keyFile.toAbsolutePath().getParent();
        Files.createDirectories(parent);
        Files.writeString(keyFile, pem, StandardCharsets.US_ASCII);
        try {
            // 所有者だけが読み書きできるようにする (POSIX 以外のファイルシステムでは設定できないので無視)
            Files.setPosixFilePermissions(keyFile, PosixFilePermissions.fromString("rw-------"));
        }
        catch (UnsupportedOperationException ignored) {
            log.warn("このファイルシステムではパーミッションを設定できません: {}", keyFile);
        }
    }
}
