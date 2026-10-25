const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.H5_FIXTURE_URL || 'http://127.0.0.1:5188';
const outputDir = resolve(process.env.H5_FIXTURE_OUTPUT || '../../outputs/ux/ZY-UX-04');
const requests = [];
const primaryNames = ['学习专注'];

const fixtureSpace = {
  id: 'fixture-study-space', title: '隔离夹具学习空间', subtitle: '统一体验验收',
  atmosphereText: '隔离夹具，不代表正式内容状态。', durationSeconds: 180,
  audioUrl: '/static/fixture-audio.mp3', coverImageUrl: '/static/images/zhiyin-night-cafe.png',
  visualType: 'image', contentForm: 'instrumental-music',
  scenePlacements: [{
    primarySceneId: 'study-focus', secondarySceneId: 'light-focus',
    isPrimary: true, sortWeight: 10, isFeatured: true
  }],
  tags: ['夹具'],
  isFeatured: true, isMemberOnly: false, playCount: 0, favoriteCount: 0, completionRate: 0
};

function json(route, data, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });
}

async function visiblePrimaryNames(page) {
  return page.locator('.scene-name').allTextContents();
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.H5_FIXTURE_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
    const handleApiRoute = async (route) => {
      const url = new URL(route.request().url());
      requests.push({ method: route.request().method(), path: url.pathname + url.search });
      if (url.pathname === '/api/music-spaces/browse') return json(route, {
        items: [fixtureSpace], page: Number(url.searchParams.get('page')),
        pageSize: Number(url.searchParams.get('pageSize')), hasMore: false
      });
      if (url.pathname === `/api/music-spaces/${fixtureSpace.id}`) return json(route, fixtureSpace);
      if (url.pathname === `/api/music-spaces/${fixtureSpace.id}/next`) return json(route, []);
      return json(route, { code: 'FIXTURE_ROUTE_NOT_FOUND' }, 404);
    };
    await page.route('https://api.zhiyin.invalid-fixture.cn/**', handleApiRoute);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('进入场景', { exact: true }).waitFor();
    const anonymousNavigation = await visiblePrimaryNames(page);
    await page.screenshot({ path: resolve(outputDir, '01-anonymous-unified-home.png'), fullPage: true });

    await page.evaluate(() => {
      uni.setStorageSync('zhiyin.userProfile', {
        id: 'normal-user', nickname: '普通用户', mode: 'normal', memberLevel: 'free', growthLevel: 1
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('进入场景', { exact: true }).waitFor();
    const normalNavigation = await visiblePrimaryNames(page);

    await page.evaluate(() => {
      uni.setStorageSync('zhiyin.userProfile', {
        id: 'legacy-student', nickname: '旧学生用户', mode: 'student', memberLevel: 'free',
        growthLevel: 1, growthLevelName: '初遇', schoolName: '历史学校', studyGoal: '备考', minorMode: true
      });
      uni.setStorageSync('zhiyinMode', '学生');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('进入场景', { exact: true }).waitFor();
    const legacyStudentNavigation = await visiblePrimaryNames(page);
    await page.screenshot({ path: resolve(outputDir, '02-legacy-student-unified-home.png'), fullPage: true });

    await page.getByText('我的', { exact: true }).click({ force: true });
    await page.getByText('隐私与账号', { exact: true }).waitFor();
    const profileStudentControlsHidden = await page.getByText(/普通|学生资料|学习目标|校园大使/u).count() === 0;
    await page.screenshot({ path: resolve(outputDir, '03-profile-without-student-mode.png'), fullPage: true });

    await page.goto(`${baseUrl}/#/pages/student/index`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/pages\/categories\/index/u);
    await page.getByText('学习专注', { exact: true }).first().waitFor();
    await page.screenshot({ path: resolve(outputDir, '04-legacy-path-redirect.png'), fullPage: true });
    const studentRouteRedirected = page.url().includes('/pages/categories/index');
    await page.getByText(fixtureSpace.title, { exact: true }).first().click({ force: true });
    await page.getByText(fixtureSpace.title, { exact: true }).first().waitFor();
    await page.screenshot({ path: resolve(outputDir, '05-learning-free-content.png'), fullPage: true });

    const settingsPage = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
    await settingsPage.route('https://api.zhiyin.invalid-fixture.cn/**', handleApiRoute);
    await settingsPage.goto(`${baseUrl}/#/pages/student-settings/index?section=goal`, { waitUntil: 'domcontentloaded' });
    await settingsPage.waitForURL(/\/pages\/categories\/index/u);
    const studentSettingsRouteRedirected = settingsPage.url().includes('/pages/categories/index');
    await settingsPage.close();

    const writeRequests = requests.filter(({ method }) => method !== 'GET');
    const result = {
      fixture: true,
      formalContentReady: false,
      anonymousNavigation,
      normalNavigation,
      legacyStudentNavigation,
      expectedNavigation: primaryNames,
      writeRequestCount: writeRequests.length,
      assertions: {
        navigationMatches: JSON.stringify(anonymousNavigation) === JSON.stringify(primaryNames)
          && JSON.stringify(normalNavigation) === JSON.stringify(primaryNames)
          && JSON.stringify(legacyStudentNavigation) === JSON.stringify(primaryNames),
        studentEntryHidden: await page.getByText('学生', { exact: true }).count() === 0,
        profileStudentControlsHidden,
        legacyRouteRedirected: studentRouteRedirected && studentSettingsRouteRedirected,
        profileWriteRequests: writeRequests.length
      }
    };
    if (!result.assertions.navigationMatches || !result.assertions.profileStudentControlsHidden ||
        !result.assertions.legacyRouteRedirected || writeRequests.length) {
      throw new Error(`H5_UNIFIED_STUDENT_MODE_ASSERTION_FAILED:${JSON.stringify(result)}`);
    }
    writeFileSync(resolve(outputDir, 'fixture-verification.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
