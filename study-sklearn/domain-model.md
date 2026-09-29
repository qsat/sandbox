# scikit-learn ドメインモデル

出典: Developing scikit-learn estimators (`developers/develop.html`, v1.9.1)。
`✅` = 公式ドキュメントで確認済み / `❓` = 記憶ベース・未検証 / `✏️` = 検証で修正した箇所。

## 一言でいうと

**「データ変換の工場ライン」**。部品（Estimator）を規格化されたコネクタで繋ぎ、ラインごと（Pipeline）検証・調整できる。

アナロジー: **USB 規格**。機器（Estimator）の中身が何であれ、同じ端子（共通インターフェース）を持つので、差し替え・連結できる。

## 主要な概念（ユビキタス言語）

公式は「主要オブジェクト」を次の 4 つで定義している（1 つのクラスが複数を実装してよい）✅

| 概念 | 契約 | 備考 |
|------|------|------|
| **Estimator** | `fit(X, y)` / `fit(X)`。`self` を返す | 基底。`get_params` / `set_params` は `BaseEstimator` が提供 ✅ |
| **Predictor** | `predict(X)`。分類器は `decision_function` / `predict_proba` も | 教師あり・一部の教師なし ✅ |
| **Transformer** | `transform(X)`、効率が良ければ `fit_transform(X)` | 列の追加・変更・削除はよいが **行数は変えない**、出力の行順は入力と一致 ✅ |
| **Model** ✏️ | `score(X)`（高いほど良い）。適合度や尤度 | 叩き台では抜けていた概念 |

単純な Estimator と **メタ推定器（他の Estimator をラップする Estimator）** の 2 種類に分かれる。`Pipeline` と `GridSearchCV` がメタ推定器の例 ✅

具体的な種別は **Mixin** で表す ✅ — `TransformerMixin` / `RegressorMixin` / `ClassifierMixin` / `ClusterMixin`。

| 種別 | 追加の契約 |
|------|-----------|
| Regressor | 数値の `y` を受ける。`score` の既定は `r2_score` ✅ |
| Classifier | `y` は文字列/整数の列。ラベルは連続整数と仮定せず `classes_` に保持。`predict_proba` 等の列順は `classes_` に一致 ✅ |
| Clusterer | `fit` の `y` は無視。`labels_` に各サンプルのラベルを保持。`predict` は任意 ✅ |

その他（未検証 ❓）: Splitter (`KFold` など)、Scorer / Metric、Dataset の入力規約、`ColumnTransformer` / `FeatureUnion`（章立て上 8.1 に存在することだけ確認 ✅）。

## 関係

```
BaseEstimator ── get_params / set_params / clone の土台 ✅
   + Mixin（Transformer / Regressor / Classifier / Cluster）で種別を宣言 ✅
Meta-estimator ── Estimator を包む Estimator（Pipeline, GridSearchCV）✅
```

型の判定は「`transform` を持つか」や `is_classifier` / `is_regressor` で行う（duck typing）✅。1.6 以降は **Estimator Tags**（`__sklearn_tags__()`、`Tags` のインスタンス）で能力を宣言し、これらの判定やテスト（`check_estimator`）に使われる ✅

## 不変条件（公式の記述）

1. **コンストラクタは設定を保存するだけ** ✏️（叩き台より厳しい）
   - `__init__` に処理も入力検証も入れない。引数はそのまま同名の属性へ入れる。
   - 検証を `__init__` に置くと `set_params`（`GridSearchCV` が使う）でも同じ検証が必要になるため。検証は `fit` 側 ✅
   - 引数はすべて既定値付きのキーワード引数が理想。学習データは渡さない ✅
2. **`fit` は `self` を返す**。以前の `fit` は無視される（`fit(X1)` → `fit(X2)` は `fit(X2)` のみと同じ。ただし乱数と `warm_start` は例外）✅
3. **学習結果は末尾 `_` の属性** (`coef_`, `classes_`, `labels_`)。公開しない中間値は先頭 `_`。`fit` の再実行で上書きされる ✅
4. **未学習の判定**: `check_is_fitted` は末尾 `_` の属性の有無を見る。`__sklearn_is_fitted__` で上書き可 ✅
5. **`fit` 後も `X`, `y` への参照を持たない**（事前計算カーネルなど例外あり）✅
6. **入力の形**: `X` は `(n_samples, n_features)`、サンプル数が `y` と違えば `ValueError`。教師なしでも `fit(X, y=None)` の形にする（Pipeline で混在させるため）✅
7. **`n_features_in_` / `feature_names_in_`** を `fit` 時に設定（`validate_data` が自動で行う）✅
8. **データリーク防止**（Pipeline + CV の役割）❓ — `common_pitfalls.html` で要確認

## TypeScript / Java への写像（案）

```ts
interface Estimator<Self> {
  fit(X: Matrix, y?: Vector): Self;          // 自分自身を返す（可変）
  getParams(): Params;
  setParams(p: Partial<Params>): Self;
}
interface Transformer<Self> extends Estimator<Self> { transform(X: Matrix): Matrix } // 行数不変
interface Predictor<Self>   extends Estimator<Self> { predict(X: Matrix): Vector }
interface Model<Self>       extends Estimator<Self> { score(X: Matrix, y?: Vector): number }
// メタ推定器: Estimator を実装しつつ Estimator を保持 (Composite)
```

### 検討ポイント（検証を受けた更新）

- **「Unfitted / Fitted を型で分ける」案は公式設計と食い違う** ✏️
  公式は `fit` が **同じオブジェクトを変更して `self` を返す**（可変・再 `fit` 可）。未学習状態は型ではなく実行時に `check_is_fitted` で検出する。静的型で表現するなら、別設計（`fit` が新しい `Fitted<E>` を返す）を採る覚悟が要る。
- **能力の宣言は実行時の `Tags`**。クラス属性ではなくインスタンスから返り、パラメータや環境で変わりうる ✅。静的型の継承階層だけでは表せないため、Java なら Capability オブジェクト、TS なら実行時の記述子との併用が候補。
- **duck typing 前提**。公式は `isinstance` より「メソッドがあるか」を重視する ✅。TS の構造的型付けとは相性が良く、Java の名目的型付けでは interface の細分化が必要。

## 未検証で残っているもの

- [ ] `Pipeline` / `ColumnTransformer` / `FeatureUnion` の契約（`compose.html` 本文）
- [ ] Splitter (CV) と Scorer の概念（`cross_validation.html`, `model_evaluation.html`）
- [ ] データリーク防止の記述（`common_pitfalls.html`）
- [ ] `set_output` と Metadata Routing（`data_interoperability.html`, `metadata_routing.html`）
- [ ] 外れ値検出器など Predictor の他の種別
