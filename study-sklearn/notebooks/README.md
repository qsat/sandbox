# User Guide 学習ノートブック（日本語 + 動作検証）

原典: https://scikit-learn.org/stable/user_guide.html （v1.9.1）を**ガイドの並び順**で進める。
ノートブックは**実行済みの出力つき**でコミットしているので、GitHub 上でそのまま読める。

## 1 ノートブックの構成

各小節を「原典の日本語化（解説）→ コード → 実行結果 → 確認して分かったこと」の順に並べる。

- ガイドに載っている出力値は `assert` で照合する（食い違えばセルがエラーになる）。
- ガイドに書かれておらず、実行で分かったことは **発見** として書く。
- 実行していないものは「確認していない」と明記する。

## 進捗

| 節 | ノートブック | 状態 |
|----|--------------|------|
| 1.1 Linear Models | [01_supervised/01_linear_models.ipynb](./01_supervised/01_linear_models.ipynb) | ✅ 完了 |
| 1.2 Linear and Quadratic Discriminant Analysis | | 次 |
| 1.3 Kernel ridge regression | | |
| 1.4 Support Vector Machines | | |
| 1.5 Stochastic Gradient Descent | | |
| 1.6 Nearest Neighbors | | |
| 1.7 Gaussian Processes | | |
| 1.8 Cross decomposition | | |
| 1.9 Naive Bayes | | |
| 1.10 Decision Trees | | |
| 1.11 Ensembles | | |
| 1.12 Multiclass and multioutput algorithms | | |
| 1.13 Feature selection | | |
| 1.14 Semi-supervised learning | | |
| 1.15 Isotonic regression | | |
| 1.16 Probability calibration | | |
| 1.17 Neural network models (supervised) | | |
| 2〜15 章 | | 未着手（章立ては `../guide-outline.md`） |

## 手元での実行

```bash
cd study-sklearn
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/jupyter nbconvert --to notebook --execute --inplace notebooks/01_supervised/01_linear_models.ipynb
```

乱数を共有しているので、セルは上から順に実行する（途中のセルだけ再実行すると数値が変わる）。
