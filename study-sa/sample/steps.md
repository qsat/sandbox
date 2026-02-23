# SAStruts TODO アプリ 学習ステップ

## アーキテクチャ概要

```
ブラウザ
  └─ RoutingFilter (URLをActionにルーティング)
       └─ Struts ActionServlet
            └─ SAStruts Action (DI + バリデーション)
                 └─ S2JDBC JdbcManager
                      └─ H2 (Oracle Mode) インメモリDB
```

### URLとActionクラスの対応ルール

| URL                    | Actionクラス                              |
|------------------------|-------------------------------------------|
| GET  /login            | `LoginAction.index()`                     |
| POST /login/submit     | `LoginAction.submit()`                    |
| GET  /register         | `RegisterAction.index()`                  |
| POST /register/submit  | `RegisterAction.submit()`                 |
| GET  /todo             | `TodoAction.index()`                      |
| POST /todo/add         | `TodoAction.add()`                        |
| GET  /todo/edit        | `TodoAction.edit()`                       |
| POST /todo/update      | `TodoAction.update()`                     |

---

## Step 1: DB設定とスキーマ定義

**学ぶこと:** H2インメモリDB（Oracleモード）の設定、S2JDBC Dialect

- `jdbc.dicon` に H2 xaDataSource を設定
- `s2jdbc.dicon` の dialect を `h2Dialect` に変更
- `schema.sql` にテーブルとシーケンスを定義（Oracle構文）

**ポイント:** H2 Oracleモードでは `NUMBER`, `VARCHAR2`, `SEQUENCE` が使える

---

## Step 2: エンティティ設計

**学ぶこと:** S2JDBCのエンティティアノテーション、SEQUENCEによるID自動採番

- `com.example.entity.User` — USERS テーブルにマッピング
- `com.example.entity.Todo` — TODOS テーブルにマッピング

**ポイント:** `@GeneratedValue(strategy=SEQUENCE)` + `@SequenceGenerator` でOracle流の採番

---

## Step 3: ユーザー登録機能

**学ぶこと:** SAStrutsのActionクラス基本構造、バリデーションアノテーション

- `RegisterAction` — `@Required` / `@Minlength` でサーバーサイドバリデーション
- パスワードはSHA-256でハッシュして保存
- JSP: シンプルなHTMLフォーム + エラー表示

**ポイント:** `@Execute(validator=true, input="index.jsp")` でバリデーション失敗時の戻り先を指定

---

## Step 4: ログイン機能 ★ 自分で実装

**学ぶこと:** S2JDBCでのSELECT、HttpSessionの操作、PRG（Post-Redirect-Get）パターン

- `LoginAction` の `submit()` 内で認証ロジックを実装（**Learn by Doing**）
  - ユーザーを検索 → パスワードハッシュ比較 → セッションに保存 → リダイレクト

**ポイント:** SAStrutsのActionには `@Resource` で `HttpServletRequest` が注入される

---

## Step 5: TODO一覧・追加 ★ 自分で実装

**学ぶこと:** S2JDBCのINSERT、ログインチェック、リダイレクトで二重送信防止

- `TodoAction.add()` 内でTodo保存ロジックを実装（**Learn by Doing**）
  - `Todo` エンティティ生成 → `jdbcManager.insert()` → リダイレクト

---

## Step 6: TODO更新

**学ぶこと:** S2JDBCのUPDATE、URLパラメータの受け取り

- `TodoAction.edit()` / `update()` — 既存Todoを取得して更新

---

## ファイル構成（最終形）

```
src/main/
├── java/com/example/
│   ├── action/
│   │   ├── LoginAction.java
│   │   ├── RegisterAction.java
│   │   └── TodoAction.java
│   └── entity/
│       ├── User.java
│       └── Todo.java
├── resources/
│   ├── jdbc.dicon        ← H2設定
│   ├── s2jdbc.dicon      ← h2Dialect
│   └── schema.sql        ← DDL（Oracle構文）
└── webapp/WEB-INF/view/
    ├── login/index.jsp
    ├── register/index.jsp
    └── todo/
        ├── index.jsp
        └── edit.jsp
```
