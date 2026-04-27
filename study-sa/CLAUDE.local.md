# SAStruts TODO アプリ 学習進捗メモ

## プロジェクト情報
- **場所:** `/Users/satoshiarai/ghq/github.com/qsat/sandbox/study-sa/sample`
- **目標:** SAStruts + S2JDBC + H2(Oracleモード) で TODOアプリを構築しながら学習
- **起動:** `study-sa/` で `make restart` → http://localhost:8081/sample/

## 実装済み一覧（✅完了 / 🔲未着手）

### インフラ
- ✅ Docker設定（Dockerfile, docker-compose.yml, Makefile） — port 8081
- ✅ pom.xml — H2 1.4.200追加、maven-war-plugin 3.3.2に更新

### DB設定
- ✅ `jdbc.dicon` — H2 インメモリ Oracleモード (`jdbc:h2:mem:todo;MODE=Oracle`)
- ✅ `s2jdbc.dicon` — `h2Dialect` に変更
- ✅ `schema.sql` — USERS / TODOS テーブル + シーケンス（Oracle構文）

### エンティティ
- ✅ `com.example.entity.User` — USERS テーブル、SEQUENCEによるID採番
- ✅ `com.example.entity.Todo` — TODOS テーブル

### アクション
- ✅ `RegisterAction` — ユーザー登録（完全実装済み）
- ✅ `LoginAction.submit()` — 認証ロジック実装済み（adapt-aidev Phase C で実装）
- ✅ `LoginAction.index()` — ログイン画面表示
- ✅ `TodoAction.index/edit/update()` — 一覧・編集・更新
- ✅ `TodoAction.add()` — Todo保存ロジック実装済み（adapt-aidev Phase C で実装）

### JSP
- ✅ `/WEB-INF/view/login/index.jsp`
- ✅ `/WEB-INF/view/register/index.jsp`
- ✅ `/WEB-INF/view/todo/index.jsp`
- ✅ `/WEB-INF/view/todo/edit.jsp`

### ドキュメント
- ✅ `sample/steps.md` — 全学習ステップ一覧

---

## 次回再開時のタスク（優先順）

### ✅ Step 4: LoginAction の認証ロジック（adapt-aidev Phase C で実装完了）

### ✅ Step 5: TodoAction.add() の実装（adapt-aidev Phase C で実装完了）

### Step 6: 動作確認（make restart でサーバー起動 → ブラウザで確認）
- /register でユーザー登録
- /login でログイン
- /todo でTodo追加・一覧・編集

---

## はまりポイント（重要）

| 問題 | 原因 | 解決策 |
|------|------|--------|
| EL式 `${xxxAction.field}` で500エラー | S2AOPがActionをプロキシ化。`BeanELResolver`がgetterを必要とする | 各フィールドに `getXxx()` を追加 |
| `@Minlength(value=4)` コンパイルエラー | 属性名が `value` ではなく `minlength` | `@Minlength(minlength = 4)` |
| JSPのtaglib重複宣言エラー | `common.jsp` で全taglib定義済み（`include-prelude`設定） | 各JSPで再宣言しない |
| maven-war-plugin 2.1-beta-1 BUILD FAILURE | Maven 3.6.3との非互換（XStream問題） | バージョンを `3.3.2` に更新 |

---

## URLマッピングルール（SAStruts）

```
com.example.action.LoginAction    → /login
com.example.action.RegisterAction → /register
com.example.action.TodoAction     → /todo
```

- `index()` メソッド → GET `/xxx` または `/xxx/`
- `submit()` メソッド → POST `/xxx/submit`
- `add()` メソッド → POST `/xxx/add`

---

## アーキテクチャ概要

```
ブラウザ
  ↓ HTTP
RoutingFilter  → URLをActionクラス+メソッドに変換
Struts ActionServlet
  ↓ DI（@Resource）
Action（S2AOP プロキシ）
  ↓ S2JDBC
H2 インメモリDB（Oracleモード）
```

---

## ビルド・起動コマンド

```bash
# study-sa/ ディレクトリで実行
make build    # mvn package -f sample/pom.xml
make restart  # build + docker compose restart
make logs     # docker compose logs -f
```
