# 1.4 サポートベクターマシン（2/2）数式編: 主問題と双対問題

このファイルは、ノート [04_svm_2_practice_math.ipynb](../04_svm_2_practice_math.ipynb) の**数式編**です。本文は数式なしで読めるように書いてあり、ここには式・記号の表・導き方をまとめています。本文の「📐 式で確かめたい人へ」のリンクから、該当する節に飛べます。

> 中学で習う範囲から必要な道具（Σ・2 乗と √・絶対値・ベクトル・log と exp・確率など）は [数学の準備](../../00_math_primer.md) に、用語は [用語集](../../glossary.md) にまとめています。

## 目次

1. [4 つのカーネル関数](#kernels)
2. [SVC の主問題](#svc)
3. [SVC の双対問題と決定関数](#svcdual)
4. [LinearSVC とヒンジ損失](#linsvc)
5. [SVR の主問題と双対問題](#svr)
6. [数式と属性の対応](#attrs)

---

<a id="kernels"></a>

## 1. 4 つのカーネル関数

| `kernel` | 式 | 引数 |
|---|---|---|
| `"linear"` | $`\langle x, x' \rangle`$ | — |
| `"poly"`（多項式） | $`(\gamma \langle x, x' \rangle + r)^d`$ | $`d`$ = `degree`、$`r`$ = `coef0` |
| `"rbf"` | $`\exp(-\gamma \lVert x - x' \rVert^2)`$ | $`\gamma`$ = `gamma`（0 より大きい） |
| `"sigmoid"` | $`\tanh(\gamma \langle x, x' \rangle + r)`$ | $`r`$ = `coef0` |

### 🔢 数式を読む

| 記号 | 意味 |
|---|---|
| $`\langle x, x' \rangle`$ | 2 点の内積（要素ごとの積の和）。向きが似ているほど大きい |
| $`\lVert x - x' \rVert^2`$ | 2 点の距離の二乗 |
| $`\gamma`$ | どのカーネルでも「似ている度合いの感度」。`gamma='scale'`（既定）だと $`1 / (n_\text{features} \times \operatorname{Var}(X))`$ |
| $`\tanh`$ | 双曲線正接。値を −1〜1 につぶす S 字の関数 |

**日本語で読むと**: 線形は「内積そのもの」、多項式は「内積を $`d`$ 乗」（特徴の掛け算を $`d`$ 個まで考える）、RBF は「距離が近いほど 1」、シグモイドは「内積を S 字でつぶしたもの」（ニューラルネットワークの活性化関数に由来）。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../04_svm_2_practice_math.ipynb)

---

<a id="svc"></a>

## 2. SVC の主問題

📖 2 つのクラスの学習ベクトル $`x_i \in \mathbb{R}^p`$（$`i = 1, \dots, n`$）と、ベクトル $`y \in \{1, -1\}^n`$ が与えられたとき、予測 $`\operatorname{sign}(w^T \phi(x) + b)`$ がほとんどのサンプルで正しくなるような $`w \in \mathbb{R}^p`$ と $`b \in \mathbb{R}`$ を見つけることが目的です。`SVC` は次の**主問題**を解きます。

```math
\begin{aligned}
\min_{w, b, \zeta} \quad & \frac{1}{2} w^T w + C \sum_{i=1}^{n} \zeta_i \\
\text{subject to} \quad & y_i (w^T \phi(x_i) + b) \geq 1 - \zeta_i, \\
& \zeta_i \geq 0, \quad i = 1, \dots, n
\end{aligned}
```

直感的には、$`\|w\|^2 = w^T w`$ を最小化することで**マージンを最大化**しつつ、サンプルが誤分類されたり、マージンの境界の内側に入ったりしたときに罰を受けます。理想的には、すべてのサンプルで $`y_i (w^T \phi(x_i) + b)`$ が 1 以上になり、これは完全な予測を意味します。しかし実際の問題は、超平面で完全に分けられるとは限らないので、一部のサンプルが正しいマージンの境界から距離 $`\zeta_i`$ だけ離れることを許します。罰則の項 `C` がこの罰の強さを決めるので、`C` は**正則化パラメータの逆数**のように働きます。

### 🔢 数式を読む: SVC の主問題

| 記号 | 意味 |
|---|---|
| $`y_i \in \{1, -1\}`$ | サンプル $`i`$ の正解（クラスを +1 と −1 で表す） |
| $`\phi(x_i)`$ | 特徴空間への変換（カーネルで暗に計算される） |
| $`w^T \phi(x_i) + b`$ | 決定関数の値（`decision_function`）。符号がクラス |
| $`y_i (w^T \phi(x_i) + b)`$ | 「正しい側にどれだけ深く入っているか」。正なら正しく分類、1 以上ならマージンの外 |
| $`\frac{1}{2} w^T w`$ | マージンの狭さ。マージンの幅は $`2 / \lVert w \rVert`$ なので、$`\lVert w \rVert`$ を小さくするとマージンが広がる |
| $`\zeta_i \ge 0`$ | **スラック変数**: サンプル $`i`$ がマージンからどれだけはみ出したか。マージンの外なら 0、境界とマージンの間なら 0〜1、反対側（誤分類）なら 1 より大きい |
| $`C \sum_i \zeta_i`$ | はみ出しの合計に対する罰。$`C`$ が大きいほど、はみ出しを許さない |

**日本語で読むと**: 「道路の幅をできるだけ広くしたい（$`\frac{1}{2} w^T w`$ を小さく）」と「道路にはみ出す家をできるだけ少なくしたい（$`C \sum \zeta_i`$ を小さく）」の釣り合いを、$`C`$ で決める。

> 📚 **用語**: **スラック変数（slack variable）** — 「ゆるみ」の変数。厳しい条件（全部をマージンの外に）を満たせないときに、どれだけ破ってよいかを表す。$`\zeta`$ はギリシャ文字のゼータ。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../04_svm_2_practice_math.ipynb)

---

<a id="svcdual"></a>

## 3. SVC の双対問題と決定関数

### 📖 双対問題

主問題の**双対問題**は次のとおりです。

```math
\begin{aligned}
\min_{\alpha} \quad & \frac{1}{2} \alpha^T Q \alpha - e^T \alpha \\
\text{subject to} \quad & y^T \alpha = 0, \\
& 0 \leq \alpha_i \leq C, \quad i = 1, \dots, n
\end{aligned}
```

ここで $`e`$ はすべての要素が 1 のベクトル、$`Q`$ は $`n \times n`$ の半正定値行列で、$`Q_{ij} \equiv y_i y_j K(x_i, x_j)`$、$`K(x_i, x_j) = \phi(x_i)^T \phi(x_j)`$ がカーネルです。$`\alpha_i`$ を**双対係数**と呼び、上限は $`C`$ です。この双対表現から、学習ベクトルが関数 $`\phi`$ によって、より高い（無限かもしれない）次元の空間に暗に写されていることが分かります（カーネルトリック）。

最適化問題を解くと、サンプル $`x`$ に対する `decision_function` の出力は次のようになります。

```math
\sum_{i \in SV} y_i \alpha_i K(x_i, x) + b
```

予測されるクラスはその符号です。サポートベクター（マージンの内側にあるサンプル）だけについて足せばよいのは、それ以外のサンプルの双対係数 $`\alpha_i`$ が 0 だからです。これらのパラメータには、属性 `dual_coef_`（積 $`y_i \alpha_i`$ を保持）、`support_vectors_`（サポートベクター）、`intercept_`（独立の項 $`b`$）でアクセスできます。

### 🔢 数式を読む: 双対問題と決定関数

| 記号 | 意味 | scikit-learn |
|---|---|---|
| $`\alpha_i`$ | サンプル $`i`$ の双対係数（「発言力」）。0 なら予測に無関係 | — |
| $`0 \le \alpha_i \le C`$ | 発言力には上限 $`C`$ がある。$`\alpha_i = C`$ はマージン誤差（はみ出した点）、$`0 < \alpha_i < C`$ はマージンの境界上の点 | — |
| $`y^T \alpha = 0`$ | 正のクラスと負のクラスの発言力の合計が等しい | — |
| $`Q_{ij} = y_i y_j K(x_i, x_j)`$ | 正解の符号を掛けたカーネル行列 | — |
| $`y_i \alpha_i`$ | 符号付きの発言力 | `dual_coef_` |
| $`x_i`$（$`\alpha_i > 0`$ のもの） | サポートベクター | `support_vectors_` |
| $`b`$ | 切片 | `intercept_` |

**日本語で読むと**: 予測は「新しい点と各サポートベクターの似ている度合い」×「そのサポートベクターの符号付きの発言力」の合計に、切片を足したもの。1.3 のカーネルリッジ回帰と同じ形ですが、発言力が 0 でないのはサポートベクターだけです（スパース）。

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../04_svm_2_practice_math.ipynb)

---

<a id="linsvc"></a>

## 4. LinearSVC とヒンジ損失

主問題は、次のように同じ意味で書き直せます。

```math
\min_{w, b} \frac{1}{2} w^T w + C \sum_{i=1}^{n} \max(0, 1 - y_i (w^T \phi(x_i) + b))
```

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../04_svm_2_practice_math.ipynb)

---

<a id="svr"></a>

## 5. SVR の主問題と双対問題

📖 学習ベクトル $`x_i \in \mathbb{R}^p`$（$`i = 1, \dots, n`$）とベクトル $`y \in \mathbb{R}^n`$ が与えられたとき、$`\varepsilon`$-SVR は次の主問題を解きます。

```math
\begin{aligned}
\min_{w, b, \zeta, \zeta^*} \quad & \frac{1}{2} w^T w + C \sum_{i=1}^{n} (\zeta_i + \zeta_i^*) \\
\text{subject to} \quad & y_i - w^T \phi(x_i) - b \leq \varepsilon + \zeta_i, \\
& w^T \phi(x_i) + b - y_i \leq \varepsilon + \zeta_i^*, \\
& \zeta_i, \zeta_i^* \geq 0, \quad i = 1, \dots, n
\end{aligned}
```

ここでは、予測が本当の値から少なくとも $`\varepsilon`$ 離れたサンプルを罰しています。そうしたサンプルは、予測が $`\varepsilon`$-チューブの上にあるか下にあるかによって、$`\zeta_i`$ または $`\zeta_i^*`$ だけ目的関数を増やします。

### 🔢 数式を読む: SVR の主問題

| 記号 | 意味 |
|---|---|
| $`\varepsilon`$ | チューブの半分の幅（`epsilon`）。この範囲のずれは罰しない |
| $`\zeta_i`$ | 実際の値が予測より $`\varepsilon`$ 以上**上**にはみ出した量 |
| $`\zeta_i^*`$ | 実際の値が予測より $`\varepsilon`$ 以上**下**にはみ出した量 |
| $`\frac{1}{2} w^T w`$ | 関数の平らさ（係数が小さいほどなめらか） |

**日本語で読むと**: 「できるだけ平らな関数で」かつ「ε-チューブからはみ出す量の合計をできるだけ小さく」。1.3 の ε-不感損失を、スラック変数を使って制約の形で書いたもの。

📖 双対問題は次のとおりです（$`e`$ はすべて 1 のベクトル、$`Q_{ij} \equiv K(x_i, x_j)`$）。

```math
\begin{aligned}
\min_{\alpha, \alpha^*} \quad & \frac{1}{2} (\alpha - \alpha^*)^T Q (\alpha - \alpha^*) + \varepsilon e^T (\alpha + \alpha^*) - y^T (\alpha - \alpha^*) \\
\text{subject to} \quad & e^T (\alpha - \alpha^*) = 0, \\
& 0 \leq \alpha_i, \alpha_i^* \leq C, \quad i = 1, \dots, n
\end{aligned}
```

予測は次のとおりです。

```math
\sum_{i \in SV} (\alpha_i - \alpha_i^*) K(x_i, x) + b
```

これらのパラメータには、属性 `dual_coef_`（差 $`\alpha_i - \alpha_i^*`$ を保持）、`support_vectors_`、`intercept_`（$`b`$）でアクセスできます。

主問題は、次のように同じ意味で書き直せます。

```math
\min_{w, b} \frac{1}{2} w^T w + C \sum_{i=1}^{n} \max(0, |y_i - (w^T \phi(x_i) + b)| - \varepsilon)
```

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../04_svm_2_practice_math.ipynb)

---

<a id="attrs"></a>

## 6. 数式と属性の対応

### 数式と属性の対応

| 数式 | SVC | SVR |
|---|---|---|
| 双対係数 | `dual_coef_` = $`y_i \alpha_i`$ | `dual_coef_` = $`\alpha_i - \alpha_i^*`$ |
| 制約 | $`0 \le \alpha_i \le C`$、$`y^T \alpha = 0`$ | $`0 \le \alpha_i, \alpha_i^* \le C`$、$`e^T(\alpha - \alpha^*) = 0`$ |
| サポートベクター | `support_vectors_`（$`\alpha_i > 0`$ の点） | `support_vectors_`（チューブの外・縁の点） |
| 切片 | `intercept_` = $`b`$ | `intercept_` = $`b`$ |
| 予測 | $`\operatorname{sign}\left(\sum_{i \in SV} y_i \alpha_i K(x_i, x) + b\right)`$ | $`\sum_{i \in SV} (\alpha_i - \alpha_i^*) K(x_i, x) + b`$ |

[↑ 目次へ](#目次) ・ [← 本文のノートへ戻る](../04_svm_2_practice_math.ipynb)
