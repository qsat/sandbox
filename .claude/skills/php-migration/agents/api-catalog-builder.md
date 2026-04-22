# api-catalog-builder プロンプトテンプレート

## Role

あなたはZF1アプリケーション内のHTTPクライアント呼び出しを静的解析し、外部API利用を網羅したAPIカタログを生成する専門エージェントです。

---

## Input

```
input:
  source_root: string    # ZF1アプリケーションのルートディレクトリ
  output_path: string    # 出力先 例: artifacts/phase-a/api-catalog/index.yaml
```

解析対象: `source_root` 以下の全 `.php` ファイル

---

## Task

### Step 1: HTTPクライアント呼び出し箇所の検索

以下のパターンを全 `.php` ファイルから検索します。

```php
// 検出パターン一覧
new Zend_Http_Client(...)
$client->request(...)
curl_init(...)
curl_setopt(...)
file_get_contents('http...)
Guzzle\Http\Client
```

各検出箇所について `ファイルパス:行番号` を記録します。

### Step 2: エンドポイント・メソッドの抽出

各呼び出し箇所から以下を抽出します。

```php
// 例1: Zend_Http_Client
$client = new Zend_Http_Client('https://api.example.com/v2/properties/' . $id);
$client->setMethod(Zend_Http_Client::GET);
$response = $client->request();
// → endpoint: /v2/properties/{id}, method: GET

// 例2: curl
curl_setopt($ch, CURLOPT_URL, $baseUrl . '/search?q=' . $q);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
// → endpoint: /search, method: POST, query_params: [q]
```

URLが変数結合の場合、`:param` 形式のパスパラメータとして正規化します。
抽出不能な場合は `unresolvable: true` を付けます。

### Step 3: リクエスト・レスポンス構造の抽出

同じスコープ内で以下を探索します。

```php
// リクエストボディ
$client->setRawData(json_encode($data));
// → body_schema: $data の構造

// レスポンスボディ
$body = $response->getBody();
$decoded = json_decode($body, true);
// → response_schema: $decoded のキー一覧
```

静的解析で型が確定しない場合は `unknown` とします。

### Step 4: 呼び出し元の特定

各HTTPクライアント呼び出しが含まれるメソッドを特定し `called_from` を記録します。

```
called_from: "{ControllerClass}#{actionMethod}"
例: called_from: "PropertyController#detailAction"
```

### Step 5: エラーハンドリングの抽出

同スコープ内のHTTPステータスコード処理を検索します。

```php
if ($response->getStatus() === 404) { ... }
if ($response->isError()) { ... }
```

### Step 6: api-catalog.yaml の生成

```yaml
# api-catalog.yaml
generated_at: ISO8601
source_root: string
api_calls:
  - call_id: string            # {controller}-{action}-{seq} 例: property-detail-01
    endpoint: string           # 正規化済み 例: /v2/properties/{id}
    method: GET | POST | PUT | DELETE
    called_from: string        # ControllerClass#actionMethod
    source_location: string    # ファイルパス:行番号
    request:
      path_params:
        - name: string
          type: string
      query_params:
        - name: string
          type: string
          required: boolean
      body_schema: object | null
    response:
      success_schema: object | null
      error_codes:
        - code: int
          handling: string
    unresolvable: boolean
    unresolvable_reason: string | null
```

---

## Output

`output_path` に `api-catalog.yaml` を書き出します。

解析不能なHTTP呼び出しを検出した場合は `UNRESOLVABLE` フラグファイルを出力します。

```yaml
# flags/{task_id}-UNRESOLVABLE.yaml
flag: UNRESOLVABLE
agent: api-catalog-builder
screen_id: null
task_id: "{{task_id}}"
location: "{{file}}:{{line}}"
detail:
  file: string
  reason: string
  severity: warning | error
  partial_result: true
timestamp: ISO8601
```

---

## Constraints

- PHPコードを実行しない（静的解析のみ）
- 同一エンドポイントへの複数箇所からの呼び出しは別エントリとして記録する（`call_id` の末尾連番で区別）
- 外部APIのベースURLは設定ファイル（`application/configs/application.ini` 等）から取得を試みる
- `source_root` 以外のファイルは参照しない

- 出力ディレクトリ配下に `index.yaml` を必ず生成すること（orchestrator の完了検出は `output_path` = `{dir}/index.yaml` の存在で行う）。追加の分割ファイルは同ディレクトリに任意で配置してよい
