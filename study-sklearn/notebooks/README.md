# scikit-learn User Guide 学習ノートブック

原典: [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html)（v1.9.1）を、**ガイドの並び順**に日本語で学ぶための教材です。
すべて**実行済みの出力つき**でコミットしているので、GitHub 上でそのまま読めます。

## 各ノートの構成

| 記号 | 意味 |
|---|---|
| 📖 **ガイドの解説** | 公式ガイドの内容を日本語で説明したもの（省略せず、全小節を扱う） |
| 💡 **補足** | 初学者向けに、前提知識・直感・たとえ話を足したもの（ガイドにはない） |
| 📚 **用語** / 🔢 **数式を読む** | 初出の用語の説明 / 数式の記号を 1 つずつ説明し、日本語で読み下したもの |
| 🎯 **なぜ使うのか** / 🏭 **利用例** / 🕰️ **歴史** | 手法が使われる理由・実際の応用・生まれた経緯（参考情報） |
| 🧪 **やってみよう** | コードを動かして、ガイドの主張を確かめる。ガイドのサンプル出力は `assert` で照合 |
| 📈 **学習したモデルを見る** | `fit` で学習したモデル（直線・平面・曲線・決定境界・係数）を、データと重ねた図で確かめる |
| 👀 **結果の読み方** | 出力のどこを見ればよいか |
| ⚠️ **つまずきポイント** | 実際に動かして分かった落とし穴（ガイドに書かれていないもの、バージョンによる違いを含む） |

各ノートの最後に、まとめ表と確認クイズ（答えは折りたたみ）があります。
ガイドの主張が実験で再現できなかった場合は、そのまま「再現できなかった」と書いています。

## 目次と進捗

### 1. 教師あり学習

| 節 | ノート | 内容 | 状態 |
|----|--------|------|------|
| 1.1 線形モデル | [1/4 最小二乗法と正則化](./01_supervised/01_linear_models_1_ols_regularization.ipynb) | OLS, Ridge, Lasso, Multi-task Lasso, Elastic-Net（1.1.1〜1.1.6） | ✅ |
| | [2/4 特徴選択とベイズ回帰](./01_supervised/01_linear_models_2_selection_bayes.ipynb) | LARS, LARS Lasso, OMP, Bayesian Ridge, ARD（1.1.7〜1.1.10） | ✅ |
| | [3/4 分類と一般化線形モデル](./01_supervised/01_linear_models_3_classification_glm.ipynb) | ロジスティック回帰, GLM, SGD, Perceptron, PA（1.1.11〜1.1.13） | ✅ |
| | [4/4 頑健な回帰と拡張](./01_supervised/01_linear_models_4_robust_poly.ipynb) | RANSAC, Theil-Sen, Huber, 分位点回帰, 多項式回帰（1.1.14〜1.1.16） | ✅ |
| 1.2 線形判別分析と二次判別分析 | [LDA / QDA](./01_supervised/02_lda_qda.ipynb) | ベイズの定理, 多変量正規分布, マハラノビス距離, 次元削減, 縮小推定, ソルバ | ✅ |
| 1.3 カーネルリッジ回帰 | [Kernel Ridge](./01_supervised/03_kernel_ridge.ipynb) | カーネルトリック, 双対解, RBF カーネル, SVR との比較, ガウス過程との関係 | ✅ |
| 1.4 サポートベクターマシン | [1/2 分類と回帰](./01_supervised/04_svm_1_classification_regression.ipynb) | マージン最大化, 多クラス（ovo/ovr）, スコアと確率, 不均衡データ, SVR, One-Class SVM（1.4.1〜1.4.3） | ✅ |
| | [2/2 実践のコツ・カーネル・数式](./01_supervised/04_svm_2_practice_math.ipynb) | 計算量, スケーリング, nu, カーネル, C と gamma, 主問題と双対問題（1.4.4〜1.4.8） | ✅ |
| 1.5 確率的勾配降下法 | [確率的勾配降下法](./01_supervised/05_sgd.ipynb) | SGD と勾配降下法, 分類・回帰の損失, オンライン One-Class SVM, 疎なデータ, 計算量, 停止条件, 実践のコツ, 数式と学習率, 実装の工夫（1.5.1〜1.5.9） | ✅ |
| 1.6 最近傍法 | | | 次 |
| 1.7 ガウス過程 | | | |
| 1.8 交差分解 | | | |
| 1.9 ナイーブベイズ | | | |
| 1.10 決定木 | | | |
| 1.11 アンサンブル | | | |
| 1.12 多クラス・多出力 | | | |
| 1.13 特徴選択 | | | |
| 1.14 半教師あり学習 | | | |
| 1.15 等調回帰 | | | |
| 1.16 確率の較正 | | | |
| 1.17 ニューラルネットワーク（教師あり） | | | |

### 2〜15 章

未着手です。章立ては [`../guide-outline.md`](../guide-outline.md) を参照してください。

## 手元で動かす

```bash
cd study-sklearn
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/jupyter nbconvert --to notebook --execute --inplace notebooks/01_supervised/01_linear_models_1_ols_regularization.ipynb
```

実験ごとに乱数の種を固定しているので、同じ環境なら同じ数値になります。セルは上から順に実行してください（前のセルで作った変数を使うため）。
グラフの日本語表示に `japanize-matplotlib` を使っています。
