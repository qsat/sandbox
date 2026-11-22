import { config } from "./config";
import { authorizedGet, callUserInfo, clearSession, getSession, handleCallback, startLogin, TokenExpiredError } from "./oidc";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const show = (id: string, value: unknown) => {
  $(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

/** 操作名 → 実行する関数。 */
const actions: Record<string, () => Promise<unknown>> = {
  userinfo: callUserInfo,
  "api-me": () => authorizedGet(`${config.resourceServer}/api/me`),
  "api-notes": () => authorizedGet(`${config.resourceServer}/api/notes`),
};

function render(): void {
  const s = getSession();
  const loggedIn = s !== null;
  $("status").textContent = loggedIn
    ? `ログイン済み: ${String(s.idTokenClaims.name ?? s.idTokenClaims.sub)}`
    : "ログインしていません。";
  ($("login") as HTMLButtonElement).disabled = loggedIn;
  for (const id of ["userinfo", "api-me", "api-notes", "logout"]) ($(id) as HTMLButtonElement).disabled = !loggedIn;
  show("id-token-claims", s ? s.idTokenClaims : "-");
  show("access-token-info", s
    ? { scope: s.scope, expiresAt: new Date(s.expiresAt).toISOString(), refreshToken: "なし (public client には発行されない)" }
    : "-");
}

async function run(name: string): Promise<void> {
  try {
    show("result", await actions[name]!());
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      // リフレッシュトークンが無いので、認可コードフローをやり直す。
      // IdP のセッションが残っていれば、パスワードを聞かれずに画面遷移だけで戻ってくる (SSO)
      show("result", `${e.message}。ログインし直します…`);
      clearSession();
      await startLogin(name);
      return;
    }
    show("result", `エラー: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  $("login").addEventListener("click", () => void startLogin());
  $("logout").addEventListener("click", () => {
    // このアプリのメモリ上のトークンを捨てるだけ。IdP のセッションは残る (連動は 12 章)
    clearSession();
    show("result", "-");
    render();
  });
  for (const name of Object.keys(actions)) $(name).addEventListener("click", () => void run(name));

  let next: string | undefined;
  if (location.pathname === "/callback") {
    try {
      next = (await handleCallback()).next;
    } catch (e) {
      show("result", `ログインに失敗しました: ${(e as Error).message}`);
      $("result").className = "error";
    }
  }
  render();
  // 期限切れで再ログインしたときは、中断した操作の続きを実行する
  if (next && actions[next]) await run(next);
}

void main();
