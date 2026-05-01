# CLAUDE.md ベストプラクティス

## 何を書くべきか

CLAUDE.md はClaudeへの「プロジェクト文脈の渡し方」。毎回口頭で説明しなくて済む情報を書く。

### 必須セクション

**1. ビルド・テスト・Lintコマンド**
```markdown
## Commands
- Build: `npm run build`
- Test:  `npm test -- --watch=false`
- Lint:  `npm run lint`
- Dev:   `npm run dev`
```
→ Claudeが自律的にテストを回せるようになる。

**2. アーキテクチャ概要**
```markdown
## Architecture
- `src/api/`    — Express routes (thin, no business logic)
- `src/service/` — Business logic layer
- `src/db/`     — Prisma models + migrations
```
→ どのファイルを触るべきか判断できる。

**3. 重要な制約・注意事項**
```markdown
## Important Notes
- Node.js 20 required (uses --experimental-vm-modules for Jest ESM)
- DB migrations must be run manually: `npx prisma migrate deploy`
- Never import from `src/internal/` outside of `src/service/`
```
→「知らないと詰まること」を書く。WHYも一言添える。

### あると便利なセクション

**コードスタイル**
```markdown
## Code Style
- No comments unless WHY is non-obvious
- Prefer `const` over `let`; avoid `var`
- Error handling: always use custom error classes from `src/errors/`
```

**環境変数**
```markdown
## Environment Variables
- `DATABASE_URL` — PostgreSQL接続文字列
- `JWT_SECRET`   — 32バイト以上のランダム文字列 (例: openssl rand -hex 32)
```

**よくあるパターン**
```markdown
## Common Patterns
Adding a new API endpoint:
1. Route: `src/api/routes/<resource>.ts`
2. Service: `src/service/<resource>Service.ts`
3. Test: `src/__tests__/<resource>.test.ts`
```

## 何を書かないべきか

| 書かない内容              | 理由                                         |
|---------------------------|----------------------------------------------|
| 汎用コーディング規約      | グローバル CLAUDE.md に書く                  |
| パッケージの使い方        | ドキュメントを見ればわかる                   |
| 「〜してください」系のお願い | 命令形で短く書く方が確実に従われる          |
| 長い説明文                | 箇条書き・表を使う。散文は読み飛ばされる     |
| 古い情報                  | 定期的にメンテする。嘘の情報は害             |

## サイズ感の目安

- 100〜300行が理想
- 500行超えたら分割を検討（サブディレクトリの CLAUDE.md へ）
- 巨大な CLAUDE.md はトークンを浪費する

## プロジェクト CLAUDE.md テンプレート

```markdown
# <Project Name>

<1-2行のプロジェクト概要>

## Commands
- Build: `<command>`
- Test:  `<command>`
- Lint:  `<command>`

## Architecture
- `<dir>/` — <role>
- `<dir>/` — <role>

## Key Conventions
- <convention>
- <convention>

## Important Notes
- <gotcha or constraint>
```
