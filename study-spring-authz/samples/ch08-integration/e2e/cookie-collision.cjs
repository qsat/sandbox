/**
 * 再現用: IdP と Web クライアントを「同じホスト名 (localhost)」で開き、さらにセッション Cookie 名を
 * 既定の JSESSIONID に戻すと、ログインが壊れることを確かめる (本文「つまずきポイント」の再現)。
 *
 * 準備 (通常の起動手順とは違う。README の「Cookie の衝突を再現する」を参照):
 *   - web-client の redirect_uri に http://localhost:8080/login/oauth2/code/idp を DB で追加しておく
 *   - IdP と Web クライアントを --server.servlet.session.cookie.name=JSESSIONID で起動する
 * 実行: node cookie-collision.cjs
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const urls = [];
  const sessionCookie = async () => {
    const c = (await page.context().cookies()).filter((x) => x.name === 'JSESSIONID');
    return c.map((x) => x.value.slice(0, 8)).join(',') || '(なし)';
  };
  page.on('framenavigated', async (f) => {
    if (f === page.mainFrame()) urls.push(f.url().replace(/\?.*/, '?...') + '   JSESSIONID=' + (await sessionCookie()));
  });

  await page.goto('http://localhost:8080/');
  await page.click('#login');
  await page.waitForURL(/localhost:9000\/login/);
  await page.fill('#username', 'alice');
  await page.fill('#password', 'password');
  await page.click('button[type=submit]');
  // 同意済みなら同意画面は出ない
  await page.waitForURL(/localhost:9000\/oauth2\/consent|localhost:8080/);
  if (page.url().includes('/oauth2/consent')) await page.click('text=許可する');
  await page.waitForLoadState('networkidle');

  console.log('最終 URL: ' + page.url());
  console.log('画面の文言: ' + (await page.textContent('body')).replace(/\s+/g, ' ').trim());
  const cookies = await page.context().cookies();
  console.log('localhost の Cookie: ' + JSON.stringify(cookies.map((c) => `${c.name} (${c.domain})`)));
  console.log('遷移: ' + urls.join('\n      '));
  await browser.close();
})();
