# scikit-learn ドメインモデル（叩き台）

> ⚠️ 記憶ベースの仮説。`scikit-learn.org` で検証するまで確定扱いにしない。
> 検証済みの項目には `✅` を付けていく。

## 一言でいうと

**「データ変換の工場ライン」**。部品（Estimator）を規格化されたコネクタ（`fit` / `transform` / `predict`）で繋ぎ、ラインごと（Pipeline）検証・調整・出荷できる。

アナロジー: **USB 規格**。機器（Estimator）の中身が何であれ、同じ端子（共通インターフェース）を持つので、自由に差し替え・連結できる。

## 主要な概念（ユビキタス言語）

| 概念 | 役割 | 主なメソッド | 例 |
|------|------|--------------|----|
| **Estimator** | データから学習する部品の基底概念 | `fit(X, y)` / `get_params` / `set_params` | ほぼ全部 |
| **Transformer** | 特徴を変換する Estimator | `transform(X)` / `fit_transform(X)` | `StandardScaler`, `PCA` |
| **Predictor**（Classifier / Regressor / Clusterer） | 予測する Estimator | `predict(X)` / `score(X, y)` | `LogisticRegression`, `KMeans` |
| **Pipeline** | Transformer 群 + 最後に Estimator を直列合成 | Estimator と同じ | `make_pipeline(...)` |
| **ColumnTransformer** | 列ごとに別の変換を適用して結合 | Transformer と同じ | 数値列/カテゴリ列の分離処理 |
| **Meta-estimator** | Estimator を包む Estimator | Estimator と同じ | `GridSearchCV`, `BaggingClassifier` |
| **Splitter（CV）** | データ分割戦略 | `split(X, y)` | `KFold`, `StratifiedKFold` |
| **Metric / Scorer** | 評価指標 | `scoring=` | `accuracy_score`, `roc_auc_score` |
| **Dataset** | 入力データ規約 | `X`: (n_samples, n_features), `y` | `load_iris` など |

## 関係（クラス図イメージ）

```
Estimator ─┬─ Transformer ──── (Pipeline の中間段)
           ├─ Predictor  ───── (Pipeline の最終段)
           └─ Meta-estimator ─ Estimator を内包（Composite / Decorator）
                 └─ Pipeline, GridSearchCV, ColumnTransformer …

Pipeline is-a Estimator   ← 合成しても同じ型に閉じる（Composite パターン）
```

## 設計上の重要な不変条件（仮説）

1. **fit と predict の分離**: 学習で得た状態は `fit` 後に末尾 `_` 付きの属性（`coef_` など）に入る。`fit` 前に使うとエラー（未学習状態）。
2. **ハイパーパラメータは構築時、学習結果は fit 時**: コンストラクタは設定を保存するだけ。
3. **データリーク防止**: 変換の統計量は学習データのみから得る。Pipeline + CV がそれを保証する。
4. **入力規約**: `X` は 2 次元 (n_samples, n_features)。

## TypeScript / Java への写像（案）

```ts
interface Estimator<Self> {
  fit(X: Matrix, y?: Vector): Self;
  getParams(): Params;
  setParams(p: Partial<Params>): Self;
}
interface Transformer<Self> extends Estimator<Self> { transform(X: Matrix): Matrix }
interface Predictor<Self>   extends Estimator<Self> { predict(X: Matrix): Vector }
// Pipeline は Estimator を実装しつつ Transformer[] + Predictor を保持（Composite）
```

課題: Python は duck typing なので「fit 前後で利用可能なメソッドが変わる」状態を持つ。静的型では **未学習型 / 学習済み型を分ける**（`Unfitted<E>.fit(): Fitted<E>`）と表現できるかが検討ポイント。

## 検証したいこと（サイト到達後）

- [ ] Estimator の公式定義と `BaseEstimator` / Mixin の構成（Developing estimators の章）
- [ ] `predict` を持つ Estimator の分類（Classifier / Regressor / Clusterer / Outlier detector）
- [ ] 最近の API（`set_output`, メタデータルーティング, `__sklearn_tags__` など）
- [ ] ユーザーガイドの章立てと読む順序
