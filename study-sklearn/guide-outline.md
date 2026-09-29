# User Guide 章立てと読む順序

対象: scikit-learn **1.9.1** (`https://scikit-learn.org/stable/user_guide.html`、2026-09-29 取得)

## 章立て（トップレベル）

| # | 章 | URL | 性格 |
|---|----|-----|------|
| 1 | Supervised learning | `supervised_learning.html` | アルゴリズムのカタログ (1.1〜1.17) |
| 2 | Unsupervised learning | `unsupervised_learning.html` | アルゴリズムのカタログ (2.1〜2.9) |
| 3 | Model selection and evaluation | `model_selection.html` | CV / ハイパーパラメータ探索 / 閾値調整 / 指標 / 学習曲線 |
| 4 | Metadata Routing | `metadata_routing.html` | メタ推定器への `sample_weight` 等の受け渡し規約 |
| 5 | Inspection | `inspection.html` | 部分依存、Permutation importance |
| 6 | Visualizations | `visualizations.html` | Display オブジェクト API |
| 7 | Callbacks | `callbacks.html` | 学習過程へのフック（1.9 系の新章） |
| 8 | Dataset transformations | `data_transforms.html` | **Pipeline / ColumnTransformer (8.1)**、前処理 (8.3) など |
| 9 | Dataset loading utilities | `datasets.html` | データセット入出力 |
| 10 | Computing with scikit-learn | `computing.html` | スケール戦略・性能・並列 |
| 11 | Model persistence | `model_persistence.html` | 保存・読み込み |
| 12 | Common pitfalls and recommended practices | `common_pitfalls.html` | データリーク等の落とし穴 |
| 13 | Data Interoperability | `data_interoperability.html` | `set_output`（pandas/polars 出力）、Array API |
| 14 | Choosing the right estimator | `machine_learning_map.html` | 選択フローチャート |
| 15 | External Resources, Videos and Talks | `presentations.html` | 外部資料 |

ユーザーガイド外だが設計の一次資料: **Developing scikit-learn estimators** (`developers/develop.html`)。

## 読む順序（ゴールから逆算）

ゴールは「ドメインモデルを TS/Java に写像して語れる」こと。したがって **アルゴリズムのカタログ (1, 2) は最後**にし、モデルの骨格を決める章を先に読む。

| 順 | 読むもの | 目的 | 状態 |
|----|----------|------|------|
| 1 | Developing estimators (`developers/develop.html`) | Estimator / Transformer / Predictor の契約を確定 | ✅ 読了 → `domain-model.md` に反映 |
| 2 | 8.1 Pipelines and composite estimators (`modules/compose.html`) | 合成（Pipeline / FeatureUnion / ColumnTransformer / TransformedTargetRegressor）の型 | 見出しのみ確認 |
| 3 | 3.1 Cross-validation / 3.2 Tuning hyper-parameters | Splitter・メタ推定器 (`GridSearchCV`) の位置づけ | 未読 |
| 4 | 12 Common pitfalls | 不変条件（データリーク防止）の裏取り | 未読 |
| 5 | 3.4 Metrics and scoring | Scorer / Metric の概念 | 未読 |
| 6 | 4 Metadata Routing, 13 Data Interoperability | 周辺規約（メタデータ伝播、出力型） | 未読 |
| 7 | 8.3 Preprocessing, 14 Choosing the right estimator | 具体的な Transformer / 選択の地図 | 未読 |
| 8 | 1, 2 の各アルゴリズム章 | 必要になった分だけ | 未読 |

## 8.1 (compose) の見出し

- 8.1.1 Pipeline: chaining estimators（Usage / Caching transformers）
- 8.1.2 Transforming target in regression
- 8.1.3 FeatureUnion: composite feature spaces
- 8.1.4 ColumnTransformer for heterogeneous data
- 8.1.5 Visualizing Composite Estimators
