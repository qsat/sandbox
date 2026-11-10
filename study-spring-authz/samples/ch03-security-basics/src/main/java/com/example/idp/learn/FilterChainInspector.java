package com.example.idp.learn;

import java.util.List;

import jakarta.servlet.Filter;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.stereotype.Component;

/**
 * 【学習用】FilterChainProxy が持つ SecurityFilterChain と、その中のフィルターを一覧にする。
 *
 * <p>本番の IdP には不要。フィルターの並びを実物で確かめるために置いている。
 * 起動時にログへ出し、同じ内容を /learn/filters でも返す。
 */
@Component
public class FilterChainInspector {

    private static final Logger log = LoggerFactory.getLogger(FilterChainInspector.class);

    /** 1 本のチェーンの要約。matcher は「どのリクエストがこのチェーンに入るか」。 */
    public record ChainInfo(int index, String matcher, List<String> filters) {
    }

    private final FilterChainProxy filterChainProxy;

    public FilterChainInspector(FilterChainProxy filterChainProxy) {
        this.filterChainProxy = filterChainProxy;
    }

    public List<ChainInfo> describe() {
        List<SecurityFilterChain> chains = filterChainProxy.getFilterChains();
        return java.util.stream.IntStream.range(0, chains.size())
            .mapToObj(i -> {
                SecurityFilterChain chain = chains.get(i);
                String matcher = chain instanceof DefaultSecurityFilterChain d
                    ? readable(d.getRequestMatcher().toString())
                    : chain.getClass().getSimpleName();
                List<String> filters = chain.getFilters().stream()
                    .map(Filter::getClass)
                    .map(Class::getSimpleName)
                    .toList();
                return new ChainInfo(i + 1, matcher, filters);
            })
            .toList();
    }

    /**
     * 認可サーバーのチェーンの matcher はラムダ式で、toString が
     * 「パッケージ名...$$Lambda/0x...@ハッシュ」になる。読める形に縮める。
     */
    private static String readable(String matcher) {
        return matcher
            .replaceAll("/0x[0-9a-f]+@[0-9a-f]+$", "")
            .replaceAll("^([a-z0-9]+\\.)+", "");
    }

    /** 起動完了時にチェーンごとのフィルター一覧をログへ出す。 */
    @EventListener(ApplicationReadyEvent.class)
    void logFilterChains() {
        for (ChainInfo chain : describe()) {
            log.info("SecurityFilterChain #{} matcher={}", chain.index(), chain.matcher());
            for (int i = 0; i < chain.filters().size(); i++) {
                log.info("  {}. {}", i + 1, chain.filters().get(i));
            }
        }
    }
}
