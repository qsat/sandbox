/** `.git` に何も書かずに読む git の引数。`.git` を見張る側（mod）で、自分の読み取りが読み直しを繰り返させないため */
export const GIT_READ_ARGS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
