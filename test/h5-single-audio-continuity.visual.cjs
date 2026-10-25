const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.H5_FIXTURE_URL || 'http://127.0.0.1:5173';
const outputDir = resolve(process.env.H5_FIXTURE_OUTPUT || '../../outputs/ux/ZY-UX-03B');
const requests = [];
const audioBody = createWave(12, 8_000, 220);

const fixtureSpace = {
  id: 'ux03b-continuous-audio',
  title: '跨页连续播放隔离夹具',
  atmosphereText: '仅验证应用内连续播放与统一定时，不代表正式内容。',
  durationSeconds: 12,
  audioUrl: 'https://media.zhiyin.invalid-fixture.cn/ux03b.wav',
  coverImageUrl: '/static/images/zhiyin-night-cafe.png',
  visualType: 'image',
  contentForm: 'instrumental-music',
  scenePlacements: [{
    primarySceneId: 'study-focus', secondarySceneId: 'light-focus',
    isPrimary: true, sortWeight: 10, isFeatured: true
  }],
  category: '学习专注',
  tags: ['隔离夹具'],
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
    page.setDefaultTimeout(15_000);
    await page.route('https://media.zhiyin.invalid-fixture.cn/**', (route) => route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
      body: audioBody
    }));
    await page.route('https://api.zhiyin.invalid-fixture.cn/**', async (route) => {
      const url = new URL(route.request().url());
      requests.push({ method: route.request().method(), path: url.pathname + url.search });
      if (url.pathname === '/api/music-spaces/browse') return json(route, {
        items: [fixtureSpace], page: Number(url.searchParams.get('page')),
        pageSize: Number(url.searchParams.get('pageSize')), hasMore: false
      });
      if (url.pathname === `/api/music-spaces/${fixtureSpace.id}`) return json(route, fixtureSpace);
      if (url.pathname === `/api/music-spaces/${fixtureSpace.id}/next`) return json(route, []);
      return json(route, { code: 'FIXTURE_ROUTE_NOT_FOUND' }, 404);
    });

    process.stdout.write('H5_FIXTURE_BROWSER_READY\n');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    process.stdout.write('H5_FIXTURE_PAGE_LOADED\n');
    await page.getByText(fixtureSpace.title, { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByText(fixtureSpace.title, { exact: true }).first().click({ force: true });
    await page.locator('.play-button').waitFor();
    await page.locator('.play-button').click({ force: true });
    process.stdout.write('H5_FIXTURE_AUDIO_STARTED\n');
    await page.waitForTimeout(1_400);
    const playerTime = await currentDisplayedTime(page);
    await page.screenshot({ path: resolve(outputDir, '00-player-audio-running.png'), fullPage: true });

    await page.locator('.theater-back').click({ force: true });
    await page.locator('.single-audio-bar').waitFor();
    process.stdout.write('H5_FIXTURE_HOME_BAR_VISIBLE\n');
    const homeTimeBefore = await barTime(page);
    await page.waitForTimeout(2_200);
    const homeTimeAfter = await barTime(page);
    await page.screenshot({ path: resolve(outputDir, '01-home-continuous-player-bar.png'), fullPage: true });

    await page.locator('uni-tabbar .uni-tabbar__item').filter({ hasText: '场景' }).click({ force: true });
    await page.locator('.single-audio-bar').waitFor();
    const sceneTime = await barTime(page);
    await page.screenshot({ path: resolve(outputDir, '02-scene-continuous-player-bar.png'), fullPage: true });

    await page.locator('uni-tabbar .uni-tabbar__item').filter({ hasText: '我的' }).click({ force: true });
    await page.getByText('定时关闭', { exact: true }).click({ force: true });
    await page.getByText(/30分钟后关闭/u).waitFor();
    const profileTime = await barTime(page);
    await page.screenshot({ path: resolve(outputDir, '03-profile-shared-deadline.png'), fullPage: true });

    await page.locator('.bar-main').click({ force: true });
    await page.locator('.play-button').waitFor();
    const returnedTime = await currentDisplayedTime(page);
    await page.screenshot({ path: resolve(outputDir, '04-returned-player-state.png'), fullPage: true });

    const personalWrites = requests.filter(({ method, path }) => method !== 'GET' && /user-activity|favorites|history|reactions/u.test(path));
    const checks = {
      actualAudioAdvanced: homeTimeAfter > homeTimeBefore && returnedTime > playerTime,
      progressMonotonicAcrossPages: homeTimeBefore >= playerTime && sceneTime >= homeTimeAfter && profileTime >= sceneTime && returnedTime >= profileTime,
      sharedTimerVisible: await page.locator('body').getByText(/分钟/u).count() > 0,
      personalWriteCount: personalWrites.length
    };
    process.stdout.write(`H5_FIXTURE_TIMES ${JSON.stringify({ playerTime, homeTimeBefore, homeTimeAfter, sceneTime, profileTime, returnedTime })}\n`);
    if (!checks.actualAudioAdvanced || !checks.progressMonotonicAcrossPages || checks.personalWriteCount !== 0) {
      throw new Error(`H5_SINGLE_AUDIO_CONTINUITY_FAILED ${JSON.stringify(checks)}`);
    }
    writeFileSync(resolve(outputDir, 'verification.json'), `${JSON.stringify({
      fixture: true,
      realMiniProgramDeviceValidated: false,
      backgroundOrLockScreenClaimed: false,
      times: { playerTime, homeTimeBefore, homeTimeAfter, sceneTime, profileTime, returnedTime },
      requests,
      checks
    }, null, 2)}\n`, 'utf8');
  } finally {
    await browser.close();
  }
}

async function currentDisplayedTime(page) {
  const value = await page.locator('.time-row').innerText();
  return parseTime(value);
}

async function barTime(page) {
  const value = await page.locator('.single-audio-bar .bar-meta').innerText();
  return parseTime(value);
}

function parseTime(value) {
  const match = String(value).match(/(\d+):(\d{2})/u);
  if (!match) throw new Error(`H5_TIME_NOT_FOUND ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function createWave(seconds, sampleRate, frequency) {
  const sampleCount = seconds * sampleRate;
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * frequency * Math.PI * 2) * 0.08;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
