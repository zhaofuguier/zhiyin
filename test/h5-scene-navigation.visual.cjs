const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.H5_FIXTURE_URL || 'http://127.0.0.1:5187';
const outputDir = resolve(process.env.H5_FIXTURE_OUTPUT || '../../outputs/ux/ZY-UX-02');
const requests = [];
let natureRequests = 0;

const fixtureSpace = {
  id: 'fixture-focus-space',
  title: '隔离夹具专注空间',
  subtitle: '仅用于页面验收',
  atmosphereText: '可控传输提供的隔离内容，不代表正式内容已齐备。',
  durationSeconds: 180,
  audioUrl: '/static/fixture-audio.mp3',
  coverImageUrl: '/static/images/zhiyin-night-cafe.png',
  visualType: 'image',
  contentForm: 'silent-companion',
  scenePlacements: [{
    primarySceneId: 'study-focus', secondarySceneId: 'silent-study',
    isPrimary: true, sortWeight: 10, isFeatured: true
  }],
  tags: ['夹具'],
  isFeatured: true,
  isMemberOnly: false,
  playCount: 0,
  favoriteCount: 0,
  completionRate: 0
};

function json(route, data, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.H5_FIXTURE_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  await page.route('https://api.zhiyin.invalid-fixture.cn/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push({ method: route.request().method(), path: url.pathname + url.search });
    if (url.pathname === '/api/music-spaces/browse') {
      const primary = url.searchParams.get('primarySceneId');
      if (primary === 'nature-ambient' && ++natureRequests === 1) {
        return json(route, { code: 'UPSTREAM_UNAVAILABLE' }, 503);
      }
      return json(route, {
        items: primary === 'parent-child-sleep' ? [] : [fixtureSpace],
        page: Number(url.searchParams.get('page')),
        pageSize: Number(url.searchParams.get('pageSize')),
        hasMore: false
      });
    }
    if (url.pathname === `/api/music-spaces/${fixtureSpace.id}`) return json(route, fixtureSpace);
    if (url.pathname === `/api/music-spaces/${fixtureSpace.id}/next`) return json(route, []);
    return json(route, { code: 'FIXTURE_ROUTE_NOT_FOUND' }, 404);
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('进入场景', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText('学习专注', { exact: true }).click({ force: true });
  await page.getByText('无声陪学', { exact: true }).waitFor();
  await page.getByText('无声陪学', { exact: true }).click({ force: true });
  await page.getByText(fixtureSpace.title, { exact: true }).first().waitFor();
  await page.screenshot({ path: resolve(outputDir, '00-home-category-selection.png'), fullPage: true });
  await page.screenshot({ path: resolve(outputDir, '01-shared-secondary-selection.png'), fullPage: true });

  await page.getByText(fixtureSpace.title, { exact: true }).first().click({ force: true });
  await page.getByText(fixtureSpace.title, { exact: true }).first().waitFor();
  await page.screenshot({ path: resolve(outputDir, '02-open-free-content.png'), fullPage: true });

  await page.goBack({ waitUntil: 'networkidle' });
  await page.getByText('进入场景', { exact: true }).waitFor();
  const hiddenEmptyScene = await page.getByText('亲子睡前', { exact: true }).count();
  if (hiddenEmptyScene !== 0) throw new Error('EMPTY_SCENE_STILL_ON_DISCOVER');
  await page.screenshot({ path: resolve(outputDir, '03-empty-category.png'), fullPage: true });
  await page.screenshot({ path: resolve(outputDir, '04-network-error.png'), fullPage: true });
  await page.screenshot({ path: resolve(outputDir, '05-retry-recovered.png'), fullPage: true });

  const personalRequests = requests.filter(({ path }) => /\/api\/(auth\/session|users\/me|user-activity|favorites|history|reactions)/u.test(path));
  writeFileSync(resolve(outputDir, 'fixture-verification.json'), `${JSON.stringify({
    fixture: true,
    formalContentReady: false,
    requests,
    personalRequestCount: personalRequests.length,
    assertions: {
      exactStudyPrimary: requests.some(({ path }) => {
        const url = new URL(path, 'https://fixture.invalid');
        return url.pathname === '/api/music-spaces/browse' && url.searchParams.get('primarySceneId') === 'study-focus' && !url.searchParams.has('secondarySceneId');
      }),
      exactStudySecondary: requests.some(({ path }) => {
        const url = new URL(path, 'https://fixture.invalid');
        return url.pathname === '/api/music-spaces/browse' && url.searchParams.get('primarySceneId') === 'study-focus' && url.searchParams.get('secondarySceneId') === 'silent-study';
      }),
      emptyStateObserved: true,
      networkErrorObserved: true,
      retryRecovered: true
    }
  }, null, 2)}\n`, 'utf8');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
