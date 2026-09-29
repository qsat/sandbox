"""1.1 Linear Models の動作検証。ガイドの記述を1つずつ実行で確かめる。

実行: .venv/bin/python guide/01-supervised/01_linear_models.py
"""
import warnings

import numpy as np
from scipy.special import expit
from sklearn import linear_model as lm
from sklearn.preprocessing import PolynomialFeatures
from sklearn.pipeline import Pipeline

np.set_printoptions(precision=4, suppress=True)
rng = np.random.RandomState(0)


def h(title):
    print(f"\n=== {title} ===")


# ---------------------------------------------------------------- 1.1.1 OLS
h("1.1.1 OLS: ガイドの例")
reg = lm.LinearRegression().fit([[0, 0], [1, 1], [2, 2]], [0, 1, 2])
print("coef_", reg.coef_, "intercept_", reg.intercept_)
# 特徴が完全共線 (x1 == x2) なので、係数は 0.5/0.5 (最小ノルム解) に定まる
assert np.allclose(reg.coef_, [0.5, 0.5])

h("1.1.1 多重共線性: 特徴がほぼ同一のとき、係数がノイズに敏感になる")
n = 50
x1 = rng.randn(n)
for eps in [1.0, 0.01, 0.0001]:
    x2 = x1 + eps * rng.randn(n)  # eps が小さいほど x1 とほぼ同じ
    X = np.c_[x1, x2]
    coefs = []
    for seed in range(200):
        y = x1 + np.random.RandomState(seed).randn(n) * 0.5  # 真の係数は (1, 0)
        coefs.append(lm.LinearRegression().fit(X, y).coef_)
    print(f"x2=x1+{eps:<6} coef[0] の標準偏差 {np.std(np.array(coefs)[:, 0]):.3f}")

h("1.1.1.1 Non-negative least squares (positive=True)")
X = rng.randn(100, 3)
y = X @ [2.0, -1.0, 0.5] + 0.1 * rng.randn(100)
print("通常     :", lm.LinearRegression().fit(X, y).coef_)
print("positive :", lm.LinearRegression(positive=True).fit(X, y).coef_)
assert (lm.LinearRegression(positive=True).fit(X, y).coef_ >= 0).all()

# ---------------------------------------------------------------- 1.1.2 Ridge
h("1.1.2.1 Ridge: ガイドの例")
reg = lm.Ridge(alpha=0.5).fit([[0, 0], [0, 0], [1, 1]], [0, 0.1, 1])
print("coef_", reg.coef_, "intercept_", reg.intercept_)
assert np.allclose(reg.coef_, [0.34545455] * 2) and np.isclose(reg.intercept_, 0.13636, atol=1e-5)

h("1.1.2.1 alpha を大きくすると係数が縮む (shrinkage)")
X = rng.randn(60, 5)
y = X @ [3, -2, 1, 0, 0] + rng.randn(60)
for a in [0, 1, 10, 100, 1000]:
    print(f"alpha={a:<5}", "||w||2 =", round(float(np.linalg.norm(lm.Ridge(alpha=a).fit(X, y).coef_)), 3))

h("1.1.2.1 solver='auto' の選択規則 (positive=True -> lbfgs)")
print("dense:", lm.Ridge().fit(X, y).coef_[:2], "/ positive=True:", lm.Ridge(positive=True).fit(X, y).coef_[:2])

h("1.1.2.2 RidgeClassifier: 二値目的変数を {-1,1} に直して回帰、符号で分類")
Xc = np.r_[rng.randn(30, 2) + [2, 2], rng.randn(30, 2) - [2, 2]]
yc = np.r_[np.ones(30, int), np.zeros(30, int)]
rc = lm.RidgeClassifier().fit(Xc, yc)
pred_by_sign = (rc.decision_function(Xc) > 0).astype(int)
print("classes_", rc.classes_, "| predict == 符号判定:", (rc.predict(Xc) == pred_by_sign).all())
ridge_pm = lm.Ridge().fit(Xc, 2 * yc - 1)  # 手で {-1,1} にして Ridge
print("二値の coef_ の形: RidgeClassifier", rc.coef_.shape, "/ LogisticRegression", lm.LogisticRegression().fit(Xc, yc).coef_.shape)
print("Ridge(±1) の係数・decision_function と一致:", np.allclose(ridge_pm.coef_, rc.coef_), np.allclose(ridge_pm.predict(Xc), rc.decision_function(Xc)))

h("1.1.2.4 RidgeCV: ガイドの例 (既定は LOO-CV)")
reg = lm.RidgeCV(alphas=np.logspace(-6, 6, 13)).fit([[0, 0], [0, 0.1], [1, 1]], [0, -0.1, 1])
print("alpha_", reg.alpha_)
assert np.isclose(reg.alpha_, 0.1)
try:
    lm.RidgeCV(alphas=[0.0, 1.0]).fit(X, y)
except ValueError as e:
    print("alpha=0 + LOO ->", type(e).__name__, str(e)[:70])

# ---------------------------------------------------------------- 1.1.3 Lasso
h("1.1.3 Lasso: ガイドの例と、係数が厳密に 0 になること")
reg = lm.Lasso(alpha=0.1).fit([[0, 0], [1, 1]], [0, 1])
print("predict([[1,1]]) =", reg.predict([[1, 1]]))
assert np.allclose(reg.predict([[1, 1]]), [0.8])
X = rng.randn(100, 10)
y = X[:, 0] * 3 - X[:, 1] * 2 + 0.5 * rng.randn(100)
for name, m in [("Ridge", lm.Ridge(alpha=10)), ("Lasso", lm.Lasso(alpha=0.3))]:
    c = m.fit(X, y).coef_
    print(f"{name:6} 厳密な0の個数 = {(c == 0).sum()} / 10   coef = {c}")

h("1.1.3.1 soft-thresholding: 直交設計 (||x_j||^2 = n) なら w_j = S(x_j^T y / n, alpha)")
Xo = np.linalg.qr(rng.randn(200, 4))[0] * np.sqrt(200)  # 列が直交, ||x_j||^2 = n
yo = Xo @ [3, 1, 0.2, -0.05] + 0.01 * rng.randn(200)
alpha = 0.3
z = Xo.T @ yo / 200
manual = np.sign(z) * np.maximum(0, np.abs(z) - alpha)
# fit_intercept=False: 中心化すると列の直交性が崩れるため、定数項なしで比べる
lasso = lm.Lasso(alpha=alpha, fit_intercept=False, tol=1e-12).fit(Xo, yo).coef_
print("手計算:", manual, "\nLasso :", lasso)
assert np.allclose(manual, lasso, atol=1e-4)

h("1.1.3.2 LassoCV と LassoLarsIC (AIC/BIC)")
print("LassoCV alpha_ =", round(lm.LassoCV(cv=5).fit(X, y).alpha_, 4))
for crit in ["aic", "bic"]:
    ic = lm.LassoLarsIC(criterion=crit).fit(X, y)
    print(f"LassoLarsIC({crit}) alpha_ = {ic.alpha_:.4f}, 非ゼロ = {(ic.coef_ != 0).sum()}")

# ---------------------------------------------------------------- 1.1.4 - 1.1.6
h("1.1.4 MultiTaskLasso: 全タスクで同じ特徴が選ばれる (非ゼロは列単位)")
W = np.zeros((8, 3)); W[[0, 3], :] = rng.randn(2, 3) * 3
X = rng.randn(80, 8); Y = X @ W + 0.1 * rng.randn(80, 3)
mt = lm.MultiTaskLasso(alpha=0.2).fit(X, Y)
print("MultiTaskLasso 非ゼロ行:", np.flatnonzero((mt.coef_ != 0).any(axis=0)),
      "| 行内で非ゼロが揃っているか:", ((mt.coef_ != 0).all(axis=0) | (mt.coef_ == 0).all(axis=0)).all())
sc = np.array([lm.Lasso(alpha=0.2).fit(X, Y[:, k]).coef_ != 0 for k in range(3)])
print("個別 Lasso の非ゼロ位置(タスクごと):\n", sc.astype(int))

h("1.1.5 ElasticNet: 相関の強い特徴 -> Lasso は片方、ElasticNet は両方")
z = rng.randn(200)
X = np.c_[z + 0.01 * rng.randn(200), z + 0.01 * rng.randn(200), rng.randn(200)]
y = z * 2 + 0.1 * rng.randn(200)
print("Lasso      :", lm.Lasso(alpha=0.1).fit(X, y).coef_)
print("ElasticNet :", lm.ElasticNet(alpha=0.1, l1_ratio=0.3).fit(X, y).coef_)

# ---------------------------------------------------------------- 1.1.7 - 1.1.9
h("1.1.8 LassoLars: ガイドの例と、係数パス (coef_path_)")
reg = lm.LassoLars(alpha=0.1).fit([[0, 0], [1, 1]], [0, 1])
print("coef_", reg.coef_)
assert np.allclose(reg.coef_, [0.6, 0.0])
X = rng.randn(100, 6); y = X[:, 0] * 3 + X[:, 2] * 1.5 + 0.1 * rng.randn(100)
path = lm.LassoLars(alpha=0.0).fit(X, y)
print("coef_path_ shape =", path.coef_path_.shape, "| 1列目は常に0:", (path.coef_path_[:, 0] == 0).all())

h("1.1.9 OMP: 非ゼロ係数の個数を指定する (l0 制約)")
for k in [1, 2, 3]:
    c = lm.OrthogonalMatchingPursuit(n_nonzero_coefs=k).fit(X, y).coef_
    print(f"n_nonzero_coefs={k}: 非ゼロ位置 {np.flatnonzero(c)}")

# ---------------------------------------------------------------- 1.1.10 Bayes
h("1.1.10.1 BayesianRidge: ガイドの例")
X = [[0.0, 0.0], [1.0, 1.0], [2.0, 2.0], [3.0, 3.0]]; Y = [0.0, 1.0, 2.0, 3.0]
br = lm.BayesianRidge().fit(X, Y)
print("predict([[1,0]]) =", br.predict([[1, 0.0]]), "coef_", br.coef_)
assert np.allclose(br.predict([[1, 0.0]]), [0.5], atol=1e-4)
print("学習された alpha_(ノイズ精度)=%.3g lambda_(重み精度)=%.3g" % (br.alpha_, br.lambda_))

h("1.1.10.2 ARD は BayesianRidge よりスパース")
X = rng.randn(100, 10); y = X[:, 0] * 2 - X[:, 1] + 0.3 * rng.randn(100)
print("BayesianRidge:", lm.BayesianRidge().fit(X, y).coef_)
print("ARDRegression:", lm.ARDRegression().fit(X, y).coef_)

# ---------------------------------------------------------------- 1.1.11 Logistic
h("1.1.11.1 二値ロジスティック回帰: predict_proba = expit(Xw + w0)")
from sklearn.datasets import load_iris, make_classification
Xb, yb = make_classification(n_samples=200, n_features=5, random_state=0)
lr = lm.LogisticRegression().fit(Xb, yb)
manual = expit(Xb @ lr.coef_[0] + lr.intercept_[0])
print("式と一致:", np.allclose(manual, lr.predict_proba(Xb)[:, 1]),
      "| 閾値0.5で predict と一致:", ((manual > 0.5).astype(int) == lr.predict(Xb)).all())

h("1.1.11.1 正則化は既定で有効。C を大きくすると無正則化に近づく")
for C in [0.01, 1, 1e6, np.inf]:
    print(f"C={C:<8} ||w|| = {np.linalg.norm(lm.LogisticRegression(C=C, max_iter=5000).fit(Xb, yb).coef_):.3f}")

h("1.1.11.1 サンプル重みを b 倍 == C を b 倍 (目的関数が S で正規化されるため)")
sw = rng.rand(len(yb)) + 0.5
a = lm.LogisticRegression(C=1.0, tol=1e-10, max_iter=5000).fit(Xb, yb, sample_weight=sw * 5).coef_
b = lm.LogisticRegression(C=5.0, tol=1e-10, max_iter=5000).fit(Xb, yb, sample_weight=sw).coef_
print("一致:", np.allclose(a, b, atol=1e-4), "\nsw*5 & C=1:", a[0][:3], "\nsw & C=5  :", b[0][:3])

h("1.1.11.2 多クラス: 全クラス K 本の重みを持つ (過剰パラメータ化) / softmax")
Xi, yi = load_iris(return_X_y=True)
mn = lm.LogisticRegression(max_iter=1000).fit(Xi, yi)
print("coef_ shape =", mn.coef_.shape, "(K=3 本)")
s = np.exp(Xi @ mn.coef_.T + mn.intercept_); s /= s.sum(axis=1, keepdims=True)
print("softmax 手計算と一致:", np.allclose(s, mn.predict_proba(Xi)))

h("1.1.11.3 ソルバごとの対応ペナルティ (表の検証)")
from sklearn.exceptions import ConvergenceWarning
warnings.simplefilter("ignore")
Xs = (Xb - Xb.mean(0)) / Xb.std(0)
for solver in ["lbfgs", "liblinear", "newton-cg", "newton-cholesky", "sag", "saga"]:
    row = []
    for label, kw in [("L2", dict(l1_ratio=0.0)), ("L1", dict(l1_ratio=1.0)),
                      ("EN", dict(l1_ratio=0.5)), ("none", dict(C=np.inf))]:
        try:
            lm.LogisticRegression(solver=solver, max_iter=300, **kw).fit(Xs, yb)
            row.append(f"{label}:yes")
        except Exception as e:
            row.append(f"{label}:no ")
    print(f"{solver:16}", " ".join(row))
warnings.resetwarnings()
print("多クラス(iris)を liblinear で:", end=" ")
try:
    lm.LogisticRegression(solver="liblinear").fit(Xi, yi); print("fit できた")
except Exception as e:
    print(type(e).__name__, str(e)[:80])

# ---------------------------------------------------------------- 1.1.12 GLM
h("1.1.12.1 TweedieRegressor: ガイドの例と、Poisson との同値性")
tw = lm.TweedieRegressor(power=1, alpha=0.5, link="log").fit([[0, 0], [0, 1], [2, 2]], [0, 1, 2])
print("coef_", tw.coef_, "intercept_", tw.intercept_)
assert np.allclose(tw.coef_, [0.2463, 0.4337], atol=1e-4)
po = lm.PoissonRegressor(alpha=0.5).fit([[0, 0], [0, 1], [2, 2]], [0, 1, 2])
print("PoissonRegressor と一致:", np.allclose(po.coef_, tw.coef_))

h("1.1.12.1 exposure: 頻度 = counts/exposure を y に、exposure を sample_weight に")
X = rng.randn(500, 1); exposure = rng.uniform(0.2, 2.0, 500)
counts = rng.poisson(exposure * np.exp(0.5 + 0.8 * X[:, 0]))
pr = lm.PoissonRegressor(alpha=1e-8).fit(X, counts / exposure, sample_weight=exposure)
print("真値 (0.5, 0.8) に対し intercept=%.3f coef=%.3f" % (pr.intercept_, pr.coef_[0]))

# ---------------------------------------------------------------- 1.1.13 SGD
h("1.1.13 SGD: loss='log_loss' はロジスティック回帰、Perceptron は SGD のラッパー")
from sklearn.linear_model import SGDClassifier, Perceptron
Xs2 = (Xb - Xb.mean(0)) / Xb.std(0)
print("SGD(log_loss) 精度 %.3f / LogisticRegression 精度 %.3f" % (
    SGDClassifier(loss="log_loss", random_state=0).fit(Xs2, yb).score(Xs2, yb),
    lm.LogisticRegression().fit(Xs2, yb).score(Xs2, yb)))
p = Perceptron(random_state=0, shuffle=False).fit(Xs2, yb)
s = SGDClassifier(loss="perceptron", learning_rate="constant", eta0=1, penalty=None,
                  random_state=0, shuffle=False).fit(Xs2, yb)
print("Perceptron と SGD(loss=perceptron, 定数学習率) の係数一致:", np.allclose(p.coef_, s.coef_))
sgd = SGDClassifier(random_state=0)
for i in range(3):  # partial_fit: オンライン/out-of-core 学習
    sgd.partial_fit(Xs2[i::3], yb[i::3], classes=[0, 1])
print("partial_fit 3回後の精度 %.3f" % sgd.score(Xs2, yb))

# ---------------------------------------------------------------- 1.1.14 Robust
h("1.1.14 ロバスト回帰: y 方向の外れ値 (真の傾き 2.0)")
x = rng.uniform(-3, 3, 100); yy = 2 * x + 1 + 0.3 * rng.randn(100)
yy[:15] += rng.uniform(15, 30, 15)  # 15% を大きな外れ値に
Xr = x[:, None]
models = {
    "OLS": lm.LinearRegression(),
    "Huber": lm.HuberRegressor(),
    "RANSAC": lm.RANSACRegressor(random_state=0),
    "TheilSen": lm.TheilSenRegressor(random_state=0),
}
for name, m in models.items():
    m.fit(Xr, yy)
    est = m.estimator_.coef_[0] if name == "RANSAC" else m.coef_[0]
    print(f"{name:9} 傾き = {est:.3f}")
print("RANSAC inlier 数:", int(models["RANSAC"].inlier_mask_.sum()), "/ 100 (外れ値 15 を除外できたか)")
print("Huber の外れ値判定 outliers_ 数:", int(models["Huber"].outliers_.sum()))

# ---------------------------------------------------------------- 1.1.15 Quantile
h("1.1.15 QuantileRegressor: 分位点 q を下回る割合 ≈ q (ノイズが不均一でも)")
x = rng.uniform(0, 10, 400); yq = 2 * x + rng.randn(400) * (0.2 + 0.4 * x)  # 分散が x に比例
Xq = x[:, None]
for q in [0.1, 0.5, 0.9]:
    m = lm.QuantileRegressor(quantile=q, alpha=0, solver="highs").fit(Xq, yq)
    print(f"q={q}: 下回る割合 = {(yq < m.predict(Xq)).mean():.3f}  傾き = {m.coef_[0]:.3f}")

# ---------------------------------------------------------------- 1.1.16 Poly
h("1.1.16 PolynomialFeatures: ガイドの例")
print(PolynomialFeatures(degree=2).fit_transform(np.arange(6).reshape(3, 2)))
x = np.arange(5); y = 3 - 2 * x + x ** 2 - x ** 3
model = Pipeline([("poly", PolynomialFeatures(degree=3)),
                  ("linear", lm.LinearRegression(fit_intercept=False))]).fit(x[:, None], y)
print("回復した係数:", model.named_steps["linear"].coef_)
assert np.allclose(model.named_steps["linear"].coef_, [3, -2, 1, -1])

h("1.1.16 interaction_only=True で XOR が線形分類器 (Perceptron) で解ける")
X = np.array([[0, 0], [0, 1], [1, 0], [1, 1]]); y = X[:, 0] ^ X[:, 1]
print("そのまま      の精度:", Perceptron(max_iter=10, tol=None, shuffle=False).fit(X, y).score(X, y))
Xi2 = PolynomialFeatures(interaction_only=True).fit_transform(X).astype(int)
clf = Perceptron(fit_intercept=False, max_iter=10, tol=None, shuffle=False).fit(Xi2, y)
print("交互作用項つき の精度:", clf.score(Xi2, y))
assert clf.score(Xi2, y) == 1.0
print("\nOK: すべての assert を通過")
