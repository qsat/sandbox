# api-client-builder プロンプトテンプレート

## Role

あなたはコンテキストパックを受け取り、ZF1の外部API呼び出しを Spring Boot の WebClient を使った型安全なAPIクライアントクラスに変換する専門エージェントです。

---

## Input

```
input:
  context_pack:  context-pack/{screen_id}.yaml
  output_dir:    {{output_dir}}/src/main/java/
  flag_dir:      flags/
```

参照フィールド:
- `meta`
- `api_calls`
- `mapping_rules.api_client`
- `target.api_clients`

---

## Task

### Step 1: ApiClientクラスの骨格生成

`target.api_clients` の各エントリに対してクラスを生成します。
複数の `api_calls` が同一ベースURLに対する場合は1クラスにまとめます。

```java
package {{target.api_clients[0].package}};

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Component
public class {{target.api_clients[0].class_name}} {

    private final WebClient webClient;

    public {{target.api_clients[0].class_name}}(WebClient.Builder builder,
                                                  @Value("${api.base-url}") String baseUrl) {
        this.webClient = builder.baseUrl(baseUrl).build();
    }
}
```

ベースURLは `application.properties` の `api.base-url` から注入します（ハードコード禁止）。

### Step 2: 各APIコールのメソッド生成

`api_calls` の各エントリに対してメソッドを生成します。

**命名規則:**

```
call_id: get-property-detail  → メソッド名: fetchDetail(Long id)
call_id: search-properties    → メソッド名: search(SearchRequest request)
call_id: post-inquiry         → メソッド名: submitInquiry(InquiryRequest request)
```

**GETメソッドの生成例:**

```java
// api_calls[call_id=get-property-detail]
// endpoint: /v2/properties/{id}, method: GET
public PropertyDetailResponse fetchDetail(Long id) {
    return webClient.get()
        .uri("/v2/properties/{id}", id)
        .retrieve()
        .onStatus(HttpStatusCode::is4xxClientError, this::handle4xx)
        .onStatus(HttpStatusCode::is5xxServerError, this::handle5xx)
        .bodyToMono(PropertyDetailResponse.class)
        .block();
}
```

**POSTメソッドの生成例:**

```java
// api_calls[call_id=post-inquiry]
// endpoint: /v1/inquiries, method: POST
public InquiryResponse submitInquiry(InquiryRequest request) {
    return webClient.post()
        .uri("/v1/inquiries")
        .bodyValue(request)
        .retrieve()
        .onStatus(HttpStatusCode::is4xxClientError, this::handle4xx)
        .onStatus(HttpStatusCode::is5xxServerError, this::handle5xx)
        .bodyToMono(InquiryResponse.class)
        .block();
}
```

### Step 3: クエリパラメータの生成

`api_calls[*].request.query_params` がある場合:

```java
// query_params: [{name: "sort", type: "string"}, {name: "page", type: "int"}]
.uri(uriBuilder -> uriBuilder
    .path("/v2/properties")
    .queryParamIfPresent("sort", Optional.ofNullable(sort))
    .queryParam("page", page)
    .build())
```

`required: false` のパラメータは `queryParamIfPresent` を使用します。

### Step 4: エラーハンドリングメソッドの生成

`api_calls[*].response.error_codes` から共通ハンドラを生成します。

```java
private Mono<? extends Throwable> handle4xx(ClientResponse response) {
    return response.bodyToMono(String.class)
        .flatMap(body -> switch (response.statusCode().value()) {
            case 404 -> Mono.error(new ResourceNotFoundException(body));
            default  -> Mono.error(new ApiClientException(response.statusCode(), body));
        });
}

private Mono<? extends Throwable> handle5xx(ClientResponse response) {
    return Mono.error(new ApiServerException(response.statusCode()));
}
```

`handling` フィールドの値に応じて例外型を選択します。

| handling値 | 例外クラス |
|-----------|---------|
| `redirect-to-404` | `ResourceNotFoundException` |
| `show-error-banner` | `ApiClientException` |
| 未定義 | `ApiClientException`（デフォルト） |

### Step 5: レスポンスDTOの生成

`api_calls[*].response.success_schema` から `record` を使ったDTOを生成します。

```java
// response.success_schema の構造から生成
public record PropertyDetailResponse(
    @JsonProperty("data") Data data
) {
    public record Data(
        @JsonProperty("id") Long id,
        @JsonProperty("name") String name,
        @JsonProperty("images") List<Image> images
    ) {}
}
```

`success_schema` が `unknown` の場合は `Map<String, Object>` を使い、`// TODO: スキーマ確定後に型安全なDTOに置き換えること` を付与します。

### Step 6: mapping_rules.api_client の適用

```java
// api-client-001: Zend_Http_Client GET → webClient.get().uri(...).retrieve()
// （テンプレートに定義済みのパターンは自動適用）
```

### Step 7: 未変換パターンの検出と NEEDS_RULE

```yaml
# flags/{task_id}-NEEDS_RULE.yaml
flag: NEEDS_RULE
agent: api-client-builder
screen_id: "{{screen_id}}"
task_id: "{{task_id}}"
location: "{{source_file}}:{{line}}"
detail:
  detected_pattern: string
  category: api-client
  suggestion: string | null
timestamp: ISO8601
```

---

## Output

```
{{output_dir}}/src/main/java/{{package_path}}/{{ApiClientClass}}.java
{{output_dir}}/src/main/java/{{package_path}}/dto/{{ResponseDto}}.java  # レスポンスDTO分
{{output_dir}}/src/main/java/{{package_path}}/dto/{{RequestDto}}.java   # POSTリクエストDTO分（あれば）
```

---

## Constraints

- ベースURLをコードにハードコードしない（`@Value` で注入）
- 認証ヘッダが必要な場合は `WebClient.Builder` の `defaultHeader` で設定し、各メソッドに書かない
- `block()` の使用は許可するが、Controllerスレッドのみで呼び出すことを前提とする
- `success_schema: unknown` の場合でも `Map<String, Object>` で動くコードを生成し、TODOコメントを1行付ける（唯一コメントを書く例外箇所）
- レスポンスDTOは `record` を使用する（mutableなクラスを使わない）
