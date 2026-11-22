/**
 * E2E: ブラウザ (Playwright の Chromium) で、IdP・Web クライアント・SPA・リソースサーバーを通しで確かめる。
 *
 * 前提 (README.md の手順で 4 つを起動しておく):
 *   - IdP は空の DB で、アクセストークンの寿命を 75 秒にして起動する (--idp.token.access-token-ttl=PT75S)
 *   - 実行: node run.cjs   (playwright は事前にインストール済みのものを使う)
 *
 * 確かめること:
 *   A. Web クライアント: ログイン → 同意 → ID トークンのクレーム → API 呼び出し →
 *      期限切れ前にリフレッシュトークンで更新される → ログアウトは IdP に影響しない (SSO)
 *   B. SPA: ログイン → UserInfo と API → 期限切れ後は認可コードフローをやり直し、画面遷移だけで戻る
 *   C. IdP にログイン済みのブラウザでは、別のクライアント (SPA) にもパスワード無しで入れる
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const TTL_SECONDS = 75;
const log = (msg) => console.log(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ページが IdP のログイン画面 (パスワード入力) を表示したかを数える。 */
function watchLoginPrompts(page) {
  const prompts = { count: 0 };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/login' && frame.url().startsWith('http://localhost:9000')) {
      prompts.count += 1;
    }
  });
  return prompts;
}

async function idpLogin(page) {
  await page.fill('#username', 'alice');
  await page.fill('#password', 'password');
  await page.click('button[type=submit]');
}

async function webClientScenario(context) {
  log('--- A. Web クライアント (http://127.0.0.1:8080) ---');
  const page = await context.newPage();
  const prompts = watchLoginPrompts(page);

  await page.goto('http://127.0.0.1:8080/');
  assert.match(await page.textContent('#status'), /ログインしていません/);
  await page.click('#login');

  await page.waitForURL(/localhost:9000\/login/);
  log('IdP のログイン画面: ' + page.url());
  await idpLogin(page);

  await page.waitForURL(/localhost:9000\/oauth2\/consent/);
  log('同意画面: ' + (await page.textContent('h1')) + ' / ' + (await page.textContent('p')).replace(/\s+/g, ' ').trim());
  const scopes = await page.$$eval('input[name=scope]', (els) => els.map((e) => e.value));
  log('同意の対象 scope: ' + scopes.join(', '));
  assert.deepEqual(scopes.sort(), ['api.read', 'email', 'profile']);
  await page.click('text=許可する');

  await page.waitForURL('http://127.0.0.1:8080/');
  assert.match(await page.textContent('#user-name'), /Alice Example/);
  const claims = await page.$$eval('#claims tr', (rows) => Object.fromEntries(rows.map((r) => [r.cells[0].textContent, r.cells[1].textContent])));
  log('ID トークンのクレーム: ' + JSON.stringify(claims));
  assert.equal(claims.iss, 'http://localhost:9000');
  assert.equal(claims.sub, 'alice');
  assert.equal(claims.email, 'alice@example.com');
  assert.deepEqual(Object.keys(claims).filter((k) => ['sid', 'auth_time', 'nonce'].includes(k)).sort(), ['auth_time', 'nonce', 'sid']);

  await page.click('#call-api');
  await page.waitForSelector('#me');
  const meText = await page.textContent('#me');
  const notesText = await page.textContent('#notes');
  log('GET /api/me    -> ' + meText);
  log('GET /api/notes -> ' + notesText);
  assert.match(meText, /sub=alice/);
  assert.match(meText, /api\.read/);
  assert.match(notesText, /ホテルのチェックイン手順/);
  const fp1 = await page.textContent('#token-fingerprint');
  const exp1 = await page.textContent('#token-expires-at');
  log(`1 回目のアクセストークン: 末尾=${fp1} 期限=${exp1}`);

  // 同じトークンがまだ有効な間は、更新されない
  await page.goto('http://127.0.0.1:8080/api-call');
  assert.equal(await page.textContent('#token-fingerprint'), fp1);

  // 期限の 60 秒前から更新の対象になる (OAuth2AuthorizedClientManager の既定の clockSkew)
  const waitMs = (TTL_SECONDS - 60 + 5) * 1000;
  log(`${waitMs / 1000} 秒待ちます (期限の 60 秒前を過ぎるまで)...`);
  await sleep(waitMs);
  await page.goto('http://127.0.0.1:8080/api-call');
  const fp2 = await page.textContent('#token-fingerprint');
  const exp2 = await page.textContent('#token-expires-at');
  log(`2 回目のアクセストークン: 末尾=${fp2} 期限=${exp2}`);
  assert.notEqual(fp2, fp1, 'アクセストークンが更新されている');
  assert.ok(new Date(exp2) > new Date(exp1));
  assert.match(await page.textContent('#notes'), /スパの予約メモ/);
  assert.equal(prompts.count, 1, 'ここまでパスワードを聞かれたのは最初の 1 回だけ');

  // クライアントからのログアウトは、クライアントのセッションだけを消す
  await page.goto('http://127.0.0.1:8080/');
  await page.click('#logout');
  await page.waitForSelector('#login');
  assert.match(await page.textContent('#status'), /ログインしていません/);
  log('クライアントからログアウトしました');

  // IdP にはログインが残っているので、もう一度ログインを押すと、パスワードを聞かれずに戻る
  await page.click('#login');
  await page.waitForURL('http://127.0.0.1:8080/');
  assert.match(await page.textContent('#user-name'), /Alice Example/);
  assert.equal(prompts.count, 1, '2 回目のログインでは IdP のログイン画面を経由していない');
  log('SSO: 再ログインでパスワードは聞かれませんでした (ログイン画面の表示回数 ' + prompts.count + ')');

  // IdP 自身の画面でも、ログイン中として見える (IdP のセッション)
  await page.goto('http://localhost:9000/');
  assert.match(await page.textContent('#username'), /alice/);
  log('IdP のホーム画面: ' + (await page.textContent('#display-name')) + ' としてログイン中');
  await page.close();
}

async function spaScenario(context, expectPassword) {
  log(`--- ${expectPassword ? 'B' : 'C'}. SPA (http://127.0.0.1:5173) ${expectPassword ? '' : '(IdP にログイン済みのブラウザ)'} ---`);
  const page = await context.newPage();
  const prompts = watchLoginPrompts(page);
  page.on('console', (m) => { if (m.type() === 'error') log('[browser console error] ' + m.text()); });

  await page.goto('http://127.0.0.1:5173/');
  await page.click('#login');
  if (expectPassword) {
    await page.waitForURL(/localhost:9000\/login/);
    await idpLogin(page);
  }
  // spa-client は同意画面を出さない設定
  await page.waitForURL('http://127.0.0.1:5173/');
  await page.waitForFunction(() => /ログイン済み/.test(document.getElementById('status').textContent));
  assert.equal(prompts.count, expectPassword ? 1 : 0);
  log('status: ' + (await page.textContent('#status')));
  const idClaims = JSON.parse(await page.textContent('#id-token-claims'));
  log('ID トークンのクレーム: ' + JSON.stringify(idClaims));
  assert.equal(idClaims.iss, 'http://localhost:9000');
  assert.equal(idClaims.aud, 'spa-client');
  const info = JSON.parse(await page.textContent('#access-token-info'));
  log('アクセストークン: ' + JSON.stringify(info));
  assert.deepEqual(info.scope.split(' ').sort(), ['api.read', 'email', 'openid', 'profile']); // scope の並び順は不定
  assert.match(info.refreshToken, /なし/);

  if (!expectPassword) {
    await page.close();
    return;
  }

  const resetResult = () => page.evaluate(() => { document.getElementById('result').textContent = '-'; });
  await resetResult();
  await page.click('#userinfo');
  await page.waitForFunction(() => /alice/.test(document.getElementById('result').textContent));
  const userinfo = JSON.parse(await page.textContent('#result'));
  log('UserInfo -> ' + JSON.stringify(userinfo));
  assert.equal(userinfo.email, 'alice@example.com');

  await resetResult();
  await page.click('#api-me');
  await page.waitForFunction(() => /"scope"/.test(document.getElementById('result').textContent));
  log('GET /api/me -> ' + (await page.textContent('#result')).replace(/\s+/g, ' '));
  await resetResult();
  await page.click('#api-notes');
  await page.waitForFunction(() => /"notes"/.test(document.getElementById('result').textContent));
  const notes = JSON.parse(await page.textContent('#result'));
  log('GET /api/notes -> ' + JSON.stringify(notes));
  assert.equal(notes.owner, 'alice');
  assert.equal(notes.notes.length, 2);

  // リフレッシュトークンが無いので、期限が切れたら認可コードフローをやり直す
  const waitMs = (TTL_SECONDS + 2) * 1000;
  log(`${waitMs / 1000} 秒待ちます (アクセストークンの期限切れまで)...`);
  await sleep(waitMs);
  await page.click('#api-notes');
  // 期限切れ → IdP へ遷移 → ログイン済みなのでそのまま戻る → 中断した操作の続きが実行される
  await page.waitForFunction(() => /"notes"/.test(document.getElementById('result').textContent) && /ログイン済み/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  assert.equal(prompts.count, 1, '期限切れの再ログインでパスワードは聞かれていない');
  const info2 = JSON.parse(await page.textContent('#access-token-info'));
  log('再ログイン後のアクセストークン期限: ' + info2.expiresAt + ' (前: ' + info.expiresAt + ')');
  assert.ok(new Date(info2.expiresAt) > new Date(info.expiresAt));
  log('期限切れ後: 画面遷移だけで戻り、ログイン画面の表示回数は ' + prompts.count + ' のまま');

  // リロードするとメモリ上のトークンは消える。IdP のセッションがあれば、ログインし直しは画面遷移だけ
  await page.reload();
  assert.match(await page.textContent('#status'), /ログインしていません/);
  log('リロード後: メモリのトークンは消えている');
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    // A → B は別のブラウザコンテキスト (= 別の Cookie の入れ物) で行い、B ではパスワードを聞かれることを確かめる
    const ctxA = await browser.newContext();
    await webClientScenario(ctxA);
    // C: A でログイン済みの IdP セッションを持つブラウザで SPA を開く → パスワード無し
    await spaScenario(ctxA, false);
    await ctxA.close();

    const ctxB = await browser.newContext();
    await spaScenario(ctxB, true);
    await ctxB.close();
    log('E2E: すべて成功');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('E2E 失敗:', e); process.exit(1); });
