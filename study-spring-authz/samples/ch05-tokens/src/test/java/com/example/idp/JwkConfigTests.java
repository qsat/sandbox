package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import com.nimbusds.jose.jwk.JWKSelector;
import com.nimbusds.jose.jwk.JWKMatcher;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;

/** 署名鍵ファイルの扱い (生成・再読み込み・kid) のテスト。 */
class JwkConfigTests {

    private static Path newKeyFile() {
        return Path.of("target", "test-keys", UUID.randomUUID() + ".pem");
    }

    @Test
    void 鍵ファイルが無ければ生成され_所有者だけが読める() throws Exception {
        Path keyFile = newKeyFile();
        assertThat(keyFile).doesNotExist();

        try (ConfigurableApplicationContext ctx = start(keyFile)) {
            assertThat(keyFile).exists();
            assertThat(Files.readString(keyFile)).startsWith("-----BEGIN PRIVATE KEY-----");
            assertThat(Files.getPosixFilePermissions(keyFile)).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        }
    }

    @Test
    void 同じ鍵ファイルを見る2つのアプリケーションコンテキストでkidと公開鍵が一致する() throws Exception {
        Path keyFile = newKeyFile();

        RSAKey first;
        try (ConfigurableApplicationContext ctx = start(keyFile)) {
            first = rsaKey(ctx);
        }
        RSAKey second;
        try (ConfigurableApplicationContext ctx = start(keyFile)) {
            second = rsaKey(ctx);
        }

        assertThat(second.getKeyID()).isEqualTo(first.getKeyID());
        assertThat(second.toRSAPublicKey()).isEqualTo(first.toRSAPublicKey());
    }

    @Test
    void 別の鍵ファイルを使うと鍵もkidも変わる() throws Exception {
        RSAKey a;
        try (ConfigurableApplicationContext ctx = start(newKeyFile())) {
            a = rsaKey(ctx);
        }
        RSAKey b;
        try (ConfigurableApplicationContext ctx = start(newKeyFile())) {
            b = rsaKey(ctx);
        }

        assertThat(b.getKeyID()).isNotEqualTo(a.getKeyID());
        assertThat(b.toRSAPublicKey()).isNotEqualTo(a.toRSAPublicKey());
    }

    private static ConfigurableApplicationContext start(Path keyFile) {
        return new SpringApplicationBuilder(IdpApplication.class)
            .web(WebApplicationType.SERVLET)
            .run("--server.port=0", "--idp.jwk.key-file=" + keyFile);
    }

    @SuppressWarnings("unchecked")
    private static RSAKey rsaKey(ConfigurableApplicationContext ctx) throws Exception {
        JWKSource<SecurityContext> source = ctx.getBean(JWKSource.class);
        return (RSAKey) source.get(new JWKSelector(new JWKMatcher.Builder().build()), null).get(0);
    }
}
