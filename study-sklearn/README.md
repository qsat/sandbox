# study-sklearn

scikit-learn.org（公式ドキュメント）の検討・学習ノート。

## ゴール（逆算の起点）

scikit-learn の設計思想を **ドメインモデル** として説明でき、TypeScript / Java の型設計に置き換えて語れる状態になる。

## 逆算プラン

| # | マイルストーン | 成果物 | 状態 |
|---|----------------|--------|------|
| 4 | 自分の言葉で TS/Java に写像して説明できる | `mapping-ts-java.md`（現状は `domain-model.md` 内に案） | 進行中 |
| 3 | 主要モジュールを一通り読み、モデルを検証・修正 | `domain-model.md` の更新 | 進行中（Developing estimators 検証済み、compose 以降は未読） |
| 2 | ユーザーガイドの章立てと読む順序を決める | `guide-outline.md` | **完了** |
| 1 | ドメインモデルの叩き台を作る | `domain-model.md` | **完了** |
| 0 | `scikit-learn.org` に到達できる | ネットワーク許可 | **完了**（v1.9.1 を参照） |

## ユーザーガイドの学習ノート

[`notebooks/`](./notebooks/README.md) に、ガイドの並び順で「日本語の解説 + 動作検証」を Jupyter ノートブック（実行済み出力つき）として積み上げる。各ノートは「ガイドの解説・初学者向けの補足・実験・結果の読み方・つまずきポイント・確認クイズ」で構成した学習教材。

## 次にやること

`guide-outline.md` の読む順序 2 以降（`compose.html` → CV / 探索 → `common_pitfalls.html` …）で、`domain-model.md` の「未検証で残っているもの」を潰す。

## 経緯

- 前回セッション「scikit-learn ユーザーガイド学習」は別リポジトリ (`qsat/agent-plugin-wiki`) 側で始まり、同じネットワーク制限と push 403 で停止した。
- 検討の場をこのリポジトリ（sandbox）に移して継続する。
