# 1.1 線形モデル（4/4）数式編: 頑健な回帰と拡張

このファイルは、ノート [01_linear_models_4_robust_poly.ipynb](../01_linear_models_4_robust_poly.ipynb) の**数式編**です。本文は数式なしで読めるように書いてあり、ここには式・記号の表・導き方をまとめています。本文の「📐 式で確かめたい人へ」のリンクから、該当する節に飛べます。

> 中学で習う範囲から必要な道具（Σ・2 乗と √・絶対値・ベクトル・log と exp・確率など）は [数学の準備](../../00_math_primer.md) に、用語は [用語集](../../glossary.md) にまとめています。

## 目次

1. [Theil-Sen の計算量（二項係数）](#theilsen)
2. [Huber 回帰の目的関数](#huber)
3. [分位点回帰とピンボール損失](#pinball)
4. [多項式特徴と線形モデル](#poly)

---

<a id="theilsen"></a>

## 1. Theil-Sen の計算量（二項係数）

時間・空間の計算量は、二項係数

```math
\binom{n_\text{samples}}{n_\text{subsamples}}
```

に比例します。これは「$`n_\text{samples}`$ 個の中から $`n_\text{subsamples}`$ 個を選ぶ組み合わせの数」で、$`\binom{n}{k} = \frac{n!}{k!\,(n-k)!}`$ です（$`n!`$ は $`n \times (n-1) \times \dots \times 1`$）。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../01_linear_models_4_robust_poly.ipynb)

---

<a id="huber"></a>

## 2. Huber 回帰の目的関数

**📖 数式（Mathematical details）**: `HuberRegressor` は次の式を最小化します。$`\sigma`$ はデータのスケールで、係数と同時に推定されます。

```math
\min_{w, \sigma} \sum_{i=1}^n \left( \sigma + H_\epsilon\left( \frac{X_i w - y_i}{\sigma} \right) \sigma \right) + \alpha \|w\|_2^2, \qquad H_\epsilon(z) = \begin{cases} z^2 & |z| < \epsilon \\ 2\epsilon|z| - \epsilon^2 & \text{それ以外} \end{cases}
```

### 🔢 数式を読む

| 記号 | 意味 |
|---|---|
| $`X_i w - y_i`$ | サンプル $`i`$ の残差 |
| $`\frac{X_i w - y_i}{\sigma}`$ | 残差をスケール $`\sigma`$ で割った値。「ふつうの何倍ずれているか」 |
| $`H_\epsilon(z)`$ | Huber 損失。$`\lvert z \rvert < \epsilon`$ なら $`z^2`$（二乗）、それ以外は $`2\epsilon \lvert z \rvert - \epsilon^2`$（直線） |
| $`\sigma + H_\epsilon(\cdot) \sigma`$ | $`\sigma`$ も同時に推定するための形。$`\sigma`$ を小さくしすぎたり大きくしすぎたりしないように釣り合いをとる |
| $`\alpha \lVert w\rVert _2^2`$ | Ridge と同じ L2 正則化 |

**日本語で読むと**: 「ふつうの大きさ」で割った残差が `epsilon` 以内なら二乗で、それを超えたら直線で罰し、全サンプルの合計を最小にする。$`2\epsilon|z| - \epsilon^2`$ の形は、$`|z| = \epsilon`$ の地点で二乗の曲線となめらかにつながるように決められています。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../01_linear_models_4_robust_poly.ipynb)

---

<a id="pinball"></a>

## 3. 分位点回帰とピンボール損失

**📖 数式（Mathematical details）**: `QuantileRegressor` は、$`q`$ 分位点（$`q \in (0, 1)`$）の線形予測 $`\hat{y}(w, X) = Xw`$ を行います。係数 $`w`$ は次の最小化問題の解です。

```math
\min_{w} \frac{1}{n_\text{samples}} \sum_i PB_q(y_i - X_i w) + \alpha \|w\|_1
```

$`PB_q`$ は**ピンボール損失**（線形損失とも呼ぶ。`mean_pinball_loss` も参照）で、$`\alpha`$ は Lasso と同様の L1 正則化です。

```math
PB_q(t) = q \max(t, 0) + (1 - q) \max(-t, 0) = \begin{cases} q t & t > 0 \\ 0 & t = 0 \\ (q - 1) t & t < 0 \end{cases}
```

### 🔢 数式を読む

| 記号 | 意味 |
|---|---|
| $`q`$ | 予測したい分位点（0.9 なら 90% 分位点）。`quantile` 引数 |
| $`t = y_i - X_i w`$ | 残差（実際 − 予測）。正なら予測が低すぎ、負なら高すぎ |
| $`PB_q(t)`$ | $`t > 0`$（低すぎ）なら $`q \cdot t`$、$`t < 0`$（高すぎ）なら $`(1 - q) \cdot \lvert t \rvert`$ の罰 |
| $`\alpha \lVert w\rVert _1`$ | Lasso と同じ L1 正則化。`alpha`（既定 1.0） |

**日本語で読むと**: 予測が低すぎたときは $`q`$ の重さで、高すぎたときは $`1 - q`$ の重さで罰を与え、その平均を最小にする。$`q = 0.5`$ なら上下同じ重さなので、残差の絶対値の平均を最小にすることになり、**中央値**を予測する。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../01_linear_models_4_robust_poly.ipynb)

---

<a id="poly"></a>

## 4. 多項式特徴と線形モデル

**📖 数式での説明（Mathematical details）**: たとえば 2 次元のデータに対する普通の線形回帰は、次のような平面のモデルです。

```math
\hat{y}(w, x) = w_0 + w_1 x_1 + w_2 x_2
```

平面ではなく放物面を当てはめたければ、特徴を 2 次の多項式に組み合わせます。

```math
\hat{y}(w, x) = w_0 + w_1 x_1 + w_2 x_2 + w_3 x_1 x_2 + w_4 x_1^2 + w_5 x_2^2
```

（ときに驚かれますが）これも**線形モデル**のままです。新しい特徴 $`z = [x_1, x_2, x_1 x_2, x_1^2, x_2^2]`$ を作ったと考えれば、

```math
\hat{y}(w, z) = w_0 + w_1 z_1 + w_2 z_2 + w_3 z_3 + w_4 z_4 + w_5 z_5
```

と書け、$`w`$ について線形なので、これまでと同じ方法で解けます。こうした**基底関数**で作った高次元の空間で線形に当てはめることで、モデルはずっと柔軟になります。

### 🔢 数式を読む

```math
\hat{y} = w_0 + w_1 x_1 + w_2 x_2 + w_3 x_1 x_2 + w_4 x_1^2 + w_5 x_2^2
```

| 項 | 意味 |
|---|---|
| $`w_1 x_1 + w_2 x_2`$ | 元の特徴の効果（平面） |
| $`w_3 x_1 x_2`$ | 交互作用。$`x_1`$ の効果の大きさが $`x_2`$ によって変わる |
| $`w_4 x_1^2 + w_5 x_2^2`$ | 曲がり。値が大きくなると効果が加速したり、頭打ちになったりする |

**日本語で読むと**: 特徴の二乗や掛け算を「新しい特徴」として加え、それぞれに係数を付けて足し合わせる。係数 $`w`$ について見れば、足し算の形のままなので線形モデル。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../01_linear_models_4_robust_poly.ipynb)
