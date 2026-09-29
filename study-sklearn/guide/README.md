# User Guide 学習ノート（日本語 + 動作検証）

原典: https://scikit-learn.org/stable/user_guide.html （v1.9.1）を**ガイドの並び順**で進める。

## 進め方（1 節ごとに同じ手順）

1. 原典の該当ページを読み、日本語で要点を整理する（`NN_xxx.md`）。
2. ガイドの主張・サンプル出力を実行で確かめる検証スクリプトを書く（`NN_xxx.py`）。ガイドに載っている出力値は `assert` で照合する。
3. 実行結果と、原典に書かれていない「発見」を md に転記する。
4. 確認できなかったものは、確認していないと明記する（推測を事実として書かない）。

環境: `cd study-sklearn && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
実行: `.venv/bin/python guide/01-supervised/01_linear_models.py`

## 進捗

| 節 | ノート | 検証 | 状態 |
|----|--------|------|------|
| 1.1 Linear Models | [md](./01-supervised/01_linear_models.md) | [py](./01-supervised/01_linear_models.py) | ✅ 完了 |
| 1.2 Linear and Quadratic Discriminant Analysis | | | 次 |
| 1.3 Kernel ridge regression | | | |
| 1.4 Support Vector Machines | | | |
| 1.5 Stochastic Gradient Descent | | | |
| 1.6 Nearest Neighbors | | | |
| 1.7 Gaussian Processes | | | |
| 1.8 Cross decomposition | | | |
| 1.9 Naive Bayes | | | |
| 1.10 Decision Trees | | | |
| 1.11 Ensembles | | | |
| 1.12 Multiclass and multioutput algorithms | | | |
| 1.13 Feature selection | | | |
| 1.14 Semi-supervised learning | | | |
| 1.15 Isotonic regression | | | |
| 1.16 Probability calibration | | | |
| 1.17 Neural network models (supervised) | | | |
| 2〜15 章 | | | 未着手（章立ては `../guide-outline.md`） |
