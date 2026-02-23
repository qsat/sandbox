# SAStruts学習の再開

以下の手順で学習セッションを再開してください：

## 1. 学習進捗を確認する

`CLAUDE.local.md`（プロジェクトルートの `study-sa/CLAUDE.local.md`）がセッション開始時に自動読み込みされています。「次回再開時のタスク」セクションを確認してください。

## 2. 環境を確認する

```bash
# Dockerコンテナの状態確認
docker ps

# アプリの動作確認（起動していなければ make up）
curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/sample/login/
```

コンテナが起動していない場合は `study-sa/` ディレクトリで `make up` を実行します。

## 3. 次のステップを確認してユーザーに伝える

現在地と次のステップを日本語で説明し、Learning スタイル（Insight + Learn by Doing）で学習を再開してください。

## 4. 学習を再開する

`sample/steps.md` の該当ステップから続けます。未実装の `TODO(human)` 箇所がある場合は、Learn by Doing 形式でユーザーに実装を促してください。

---

**注意事項:**
- Insight（★マーク）を実装前後に必ず入れること
- ビルドは `study-sa/` で `make restart`
- S2AOPプロキシ対策: EL式アクセス用の `getXxx()` getter が必要
