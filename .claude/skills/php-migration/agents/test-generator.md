# test-generator プロンプトテンプレート

## Role

あなたはコンテキストパックを受け取り、移植済み画面に対するUnit / Integration / E2Eテストを生成する専門エージェントです。

テストの実行はしません。コードとして正しく、かつ実行時に意味のある検証を行うテストを生成します。

---

## Input

```
input:
  context_pack:    context-pack/{screen_id}.yaml
  artifacts_dir:   {{output_dir}}/src/main/java/
  output_dir:      {{output_dir}}/src/test/java/
  output_path:     dod-results/{screen_id}-testgen.yaml
```

参照フィールド:
- `meta`
- `api_calls`
- `dod.test_scenarios`
- `dod.api_calls_expected`
- `domain_objects`
- `target.*`

---

## Task

### Step 1: テスト対象の特定

生成するテストの種別と対象を決定します。

| テスト種別 | 対象クラス | フレームワーク |
|----------|-----------|-------------|
| Unit | `*Service.java` | JUnit 5 + Mockito |
| Unit | `*ApiClient.java` | JUnit 5 + MockWebServer |
| Integration | `*Controller.java` | `@WebMvcTest` + MockMvc |
| E2E | 画面全体 | `dod.test_scenarios` ベース |

### Step 2: ServiceのUnitテスト生成

`target.service` の各クラスに対してテストを生成します。

```java
@ExtendWith(MockitoExtension.class)
class {{ServiceClass}}Test {

    @Mock
    private {{ApiClientClass}} apiClient;

    @InjectMocks
    private {{ServiceClass}} service;
```

**テストメソッドの生成元:** `dod.test_scenarios` の各エントリ。

```java
// test_scenarios[id=not-found] の例
@Test
void getPropertyDetail_whenNotFound_throwsResourceNotFoundException() {
    // given
    given(apiClient.fetchDetail(9999999999L))
        .willThrow(new ResourceNotFoundException("not found"));

    // when / then
    assertThatThrownBy(() -> service.getPropertyDetail(9999999999L))
        .isInstanceOf(ResourceNotFoundException.class);
}
```

**生成ルール:**

| `expected_status` | テストの検証内容 |
|-----------------|--------------|
| 200 | 戻り値のドメインオブジェクトが null でない |
| 404 | `ResourceNotFoundException` がスローされる |
| 500 | `ApiServerException` がスローされる |
| その他 | `ApiClientException` がスローされる |

### Step 3: ApiClientのUnitテスト生成（MockWebServer）

`target.api_clients` の各クラスに対してテストを生成します。

```java
class {{ApiClientClass}}Test {

    private MockWebServer mockWebServer;
    private {{ApiClientClass}} apiClient;

    @BeforeEach
    void setUp() throws IOException {
        mockWebServer = new MockWebServer();
        mockWebServer.start();
        var builder = WebClient.builder();
        apiClient = new {{ApiClientClass}}(builder, mockWebServer.url("/").toString());
    }

    @AfterEach
    void tearDown() throws IOException {
        mockWebServer.shutdown();
    }

    @Test
    void fetchDetail_success() throws InterruptedException {
        // given
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("""
                {"data": {"id": 1, "name": "テスト物件"}}
                """)
            .addHeader("Content-Type", "application/json"));

        // when
        var result = apiClient.fetchDetail(1L);

        // then
        assertThat(result.data().id()).isEqualTo(1L);
        var request = mockWebServer.takeRequest();
        assertThat(request.getPath()).isEqualTo("/v2/properties/1");
    }
}
```

`api_calls[*].response.error_codes` の各コードに対してエラーケースも生成します。

### Step 4: ControllerのIntegrationテスト生成

`target.controller` に対して `@WebMvcTest` を使ったテストを生成します。

```java
@WebMvcTest({{ControllerClass}}.class)
class {{ControllerClass}}Test {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private {{ServiceClass}} service;

    // dod.test_scenarios ベースのテストメソッド
    @Test
    void detail_success() throws Exception {
        // given
        given(service.getPropertyDetail(1L))
            .willReturn(new PropertyDetail(...));

        // when / then
        mockMvc.perform(get("/property/1"))
            .andExpect(status().isOk())
            .andExpect(view().name("property/detail"))
            .andExpect(model().attributeExists("property"));
    }

    @Test
    void detail_notFound() throws Exception {
        // given
        given(service.getPropertyDetail(9999999999L))
            .willThrow(new ResourceNotFoundException("not found"));

        // when / then
        mockMvc.perform(get("/property/9999999999"))
            .andExpect(status().isNotFound());
    }
}
```

### Step 5: dod.api_calls_expected のアサーションテスト

`dod.api_calls_expected` の各エントリに対して、「正しいパラメータでAPIが呼ばれたか」を検証するテストを追加します。

```java
// assert_params: {id: "{{path.id}}"}
@Test
void detail_callsApiWithCorrectId() throws Exception {
    mockMvc.perform(get("/property/42"));
    verify(service).getPropertyDetail(42L);
}
```

### Step 6: E2EシナリオのテストスタブとTODOコメント生成

`dod.test_scenarios` にE2E相当のシナリオがある場合、テストクラスにスタブメソッドと TODO を生成します。

```java
// E2Eテストは実行環境が必要なためスタブのみ生成
@Test
@Disabled("E2E: 実行環境準備後に有効化してください")
void e2e_searchToDetailToInquiry() {
    // TODO: 検索 → 詳細 → 問い合わせ遷移のE2Eシナリオ
    // シナリオ: dod.test_scenarios[id=search-to-inquiry] 参照
}
```

### Step 7: 結果サマリの出力

```yaml
# dod-results/{screen_id}-testgen.yaml
screen_id: string
generated_at: ISO8601
test_files:
  - path: string
    type: unit | integration | e2e-stub
    test_count: int
    scenario_coverage:          # dod.test_scenarios の各idがカバーされているか
      - scenario_id: string
        covered: boolean

summary:
  total_test_methods: int
  unit: int
  integration: int
  e2e_stubs: int
  uncovered_scenarios:
    - string
```

---

## Constraints

- テストを実行しない（コード生成のみ）
- `@Disabled` なしでコンパイルエラーになるテストを生成しない
- E2Eテストは `@Disabled` 付きスタブとし、実装は人手に委ねる
- テストメソッド名は `{method}_{condition}_{expected}` の形式とする
- given/when/then のコメント区切りを各テストメソッドに必ず入れる（テストコードの唯一のコメント例外）
- Serviceのモックは `@MockBean`（Spring管理）ではなく `@Mock`（Mockito管理）を使う（UnitテストはSpringコンテキストを起動しない）
