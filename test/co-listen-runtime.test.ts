import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { buildSync } from 'esbuild';

type Runtime = {
  co: typeof import('../src/services/co-listen');
  player: typeof import('../src/services/co-listen-player');
};
type Reply = { statusCode: number; data: unknown };

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(root, '.test-co-listen-'));
const require = createRequire(import.meta.url);
const storage = new Map<string, unknown>();
const replies: Reply[] = [];
const requests: Array<Record<string, unknown>> = [];
let runtime: Runtime;

before(() => {
  (globalThis as Record<string, unknown>).uni = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    $emit() {},
    request(options: { url: string; method?: string; data?: unknown; header?: unknown; success(value: Reply): void }) {
      requests.push({ url: options.url, method: options.method, data: options.data, header: options.header });
      const reply = replies.shift();
      if (!reply) throw new Error('UNEXPECTED_REQUEST');
      options.success(reply);
    }
  };
  const entry = join(temp, 'entry.ts');
  writeFileSync(entry, `export * as co from '../src/services/co-listen.ts';\nexport * as player from '../src/services/co-listen-player.ts';\n`);
  const output = join(temp, 'runtime.cjs');
  buildSync({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { 'import.meta.env': JSON.stringify({ VITE_APP_MODE: 'production', VITE_API_BASE_URL: 'https://api.zhiyin.invalid-fixture.cn', DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID: 'test_template_001' }) }, logLevel: 'silent' });
  runtime = require(output) as Runtime;
});
beforeEach(() => {
  storage.clear(); replies.length = 0; requests.length = 0;
  storage.set('zhiyin.sessionToken', 'session-token');
});
after(() => rmSync(temp, { recursive: true, force: true }));

test('co-listen REST contracts use bearer identity and never submit userId, roomId or platform overrides', async () => {
  replies.push({ statusCode: 200, data: createdRoom() });
  const result = await runtime.co.createCoListenRoom('space-1');
  assert.equal(result.room.platform, 'wechat');
  assert.deepEqual(requests[0]?.data, { musicSpaceId: 'space-1', nicknameSharingConsent: true });
  assert.match(JSON.stringify(requests[0]?.header), /Bearer session-token/u);
  assert.doesNotMatch(JSON.stringify(requests[0]?.data), /userId|roomId|platform/u);
});

test('invalid 2xx room payload is rejected instead of creating a local room', async () => {
  replies.push({ statusCode: 200, data: { room: {}, selfParticipantId: 'self' } });
  await assert.rejects(() => runtime.co.joinCoListenRoom('x'.repeat(43), 'space-1'), /CO_LISTEN_RESPONSE_INVALID/u);
  assert.equal(requests.length, 1);
});

test('same-platform native share paths contain only musicSpaceId and listenInvite', () => {
  const path = runtime.co.coListenSharePath('space one', 'secret_invite_token');
  assert.equal(path, '/pages/player/index?musicSpaceId=space%20one&listenInvite=secret_invite_token');
  assert.doesNotMatch(path, /roomId|userId|session|platform/u);
  assert.deepEqual(runtime.player.coListenNativeShare('wechat', { title: '来和我一起听', path, douyinTemplateId: '' }), { title: '来和我一起听', path });
  assert.deepEqual(runtime.player.coListenNativeShare('douyin', { title: '来和我一起听', path, douyinTemplateId: 'test_template_001' }), { title: '来和我一起听', path, templateId: 'test_template_001' });
  assert.throws(() => runtime.player.coListenNativeShare('douyin', { title: '邀请', path, douyinTemplateId: '' }), /CO_LISTEN_NATIVE_SHARE_NOT_CONFIGURED/u);
});

test('secure socket URL carries only the one-use ticket and drift correction starts above two seconds', () => {
  const url = new URL(runtime.co.coListenSocketUrl('ticket_only'));
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.pathname, '/api/co-listen/ws');
  assert.deepEqual([...url.searchParams.keys()], ['ticket']);
  assert.equal(runtime.co.shouldCorrectCoListenDrift(10, 12), false);
  assert.equal(runtime.co.shouldCorrectCoListenDrift(10, 12.01), true);
  assert.deepEqual(runtime.player.resolveCoListenPlaybackAction({ localPosition: 10, expectedPosition: 12, localPlaying: false, remoteStatus: 'playing', audioArmed: false }), { playback: 'none' });
  assert.deepEqual(runtime.player.resolveCoListenPlaybackAction({ localPosition: 10, expectedPosition: 13, localPlaying: false, remoteStatus: 'playing', audioArmed: true }), { seekTo: 13, playback: 'play' });
});

test('only the owner receives one hard-limit warning during the final five minutes', () => {
  const room = createdRoom().room;
  const beforeWindow = Date.parse(room.hardExpiresAt) - 5 * 60 * 1000 - 1;
  assert.deepEqual(runtime.player.coListenHardLimitWarning({ room, selfParticipantId: 'participant-owner', now: beforeWindow, alreadyShown: false }), {
    show: false, scheduleAfterMs: 1
  });
  assert.deepEqual(runtime.player.coListenHardLimitWarning({ room, selfParticipantId: 'participant-owner', now: beforeWindow + 1, alreadyShown: false }), { show: true });
  assert.deepEqual(runtime.player.coListenHardLimitWarning({ room, selfParticipantId: 'participant-owner', now: beforeWindow + 1, alreadyShown: true }), { show: false });
  assert.deepEqual(runtime.player.coListenHardLimitWarning({ room, selfParticipantId: 'participant-member', now: beforeWindow + 1, alreadyShown: false }), { show: false });
  assert.equal(runtime.player.CO_LISTEN_HARD_LIMIT_WARNING, '本次一起听即将结束，可结束后重新发起。');
});

test('hard-limit, owner timeout, idle cleanup and manual ending have distinct safe messages', () => {
  assert.equal(runtime.player.coListenClosedMessage({ reason: 'hard-limit' }), '本次一起听已达到8小时上限');
  assert.equal(runtime.player.coListenClosedMessage({ reason: 'owner-disconnected' }), '房主离开时间过长，本次一起听已结束');
  assert.equal(runtime.player.coListenClosedMessage({ reason: 'idle' }), '房间已连续5分钟无人在线，本次一起听已结束');
  assert.equal(runtime.player.coListenClosedMessage({ reason: 'owner-ended' }), '房主已结束本次一起听');
  assert.equal(runtime.player.coListenClosedMessage({ reason: 'forged' }), '一起听房间已结束');
});

test('reconnect is finite and every reconnect obtains a fresh one-use ticket', async () => {
  const callbacks: Array<() => void> = [];
  let ticketCalls = 0;
  const events: Array<{ event: string; data: unknown }> = [];
  const client = new runtime.co.CoListenRealtimeClient({
    issueTicket: async () => { ticketCalls += 1; throw new Error('offline'); },
    connect: () => { throw new Error('not reached'); },
    schedule: (callback: () => void) => { callbacks.push(callback); return 1 as unknown as ReturnType<typeof setTimeout>; },
    cancel() {}
  });
  await client.connect('room-1', (event) => events.push(event));
  for (let index = 0; index < 3; index += 1) { callbacks.shift()?.(); await flush(); }
  assert.equal(ticketCalls, 4);
  assert.equal(events.at(-1)?.event, 'error');
  assert.deepEqual(events.at(-1)?.data, { code: 'CO_LISTEN_RECONNECT_EXHAUSTED', cause: 'CO_LISTEN_NETWORK_FAILED' });
  client.disconnect();
});

test('a closed-room ticket response stops reconnect and preserves the server close reason', async () => {
  const events: Array<{ event: string; data: unknown }> = [];
  let socketConnections = 0;
  (globalThis as { uni: Record<string, unknown> }).uni.connectSocket = () => { socketConnections += 1; throw new Error('SHOULD_NOT_CONNECT'); };
  replies.push({ statusCode: 410, data: { code: 'CO_LISTEN_ROOM_CLOSED_IDLE' } });
  const client = new runtime.co.CoListenRealtimeClient();
  await client.connect('room-closed', (event) => events.push(event));
  assert.equal(requests.length, 1);
  assert.equal(socketConnections, 0);
  assert.deepEqual(events, [{ event: 'room-closed', data: { reason: 'idle' } }]);
  client.disconnect();
});

test('opened realtime sessions send sync and bounded heartbeat, then close without retaining timers', async () => {
  let openedCallback = () => {};
  let closeCallback = () => {};
  const sent: string[] = [];
  const scheduled: Array<() => void> = [];
  let closed = 0;
  const client = new runtime.co.CoListenRealtimeClient({
    issueTicket: async () => ({ ticket: 't'.repeat(22), expiresAt: '2099-01-01T00:00:00.000Z' }),
    connect: () => ({
      onOpen(callback: () => void) { openedCallback = callback; }, onMessage() {}, onClose(callback: () => void) { closeCallback = callback; }, onError() {},
      send({ data }: { data: string }) { sent.push(data); }, close() { closed += 1; }
    }),
    schedule: (callback: () => void) => { scheduled.push(callback); return scheduled.length as unknown as ReturnType<typeof setTimeout>; },
    cancel() {}
  });
  await client.connect('room-1', () => {});
  openedCallback();
  assert.deepEqual(JSON.parse(sent[0]), { event: 'sync-request', data: {} });
  scheduled.shift()?.();
  assert.deepEqual(JSON.parse(sent[1]), { event: 'ping', data: {} });
  client.disconnect();
  closeCallback();
  assert.equal(closed, 1);
});

test('source contains no copy invite, manual invite code or cross-platform room path', () => {
  const playerPage = readFileSync(join(root, 'src', 'pages', 'player', 'index.vue'), 'utf8');
  const source = [playerPage, readFileSync(join(root, 'src', 'services', 'co-listen.ts'), 'utf8')].join('\n');
  assert.doesNotMatch(source, /复制邀请码|输入邀请码|inviteCode|跨平台/u);
  assert.doesNotMatch(playerPage, /2\s*小时/u);
});

test('leaving or closing a co-listen room destroys the inner audio context', () => {
  const playerPage = readFileSync(join(root, 'src', 'pages', 'player', 'index.vue'), 'utf8');
  const closedBranch = playerPage.slice(playerPage.indexOf("event.event === 'room-closed'"), playerPage.indexOf("event.event === 'error'"));
  const clearBody = functionBody(playerPage, 'clearCoListenLocalState');
  const resetBody = functionBody(playerPage, 'resetAudioContext');
  assert.match(functionBody(playerPage, 'exitCoListenRoom'), /clearCoListenLocalState\(\)/u);
  assert.match(closedBranch, /clearCoListenLocalState\(\)/u);
  assert.match(clearBody, /resetAudioContext\(\)/u);
  assert.match(resetBody, /mediaLifecycle\.destroyAudio\(\)/u);
  assert.equal(playerPage.match(/clearCoListenLocalState\(\)/gu)?.length, 3);
});

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`UNCLOSED_${name}`);
}

function createdRoom() {
  return { inviteToken: 'i'.repeat(43), selfParticipantId: 'participant-owner', room: {
    roomId: 'room-1', platform: 'wechat', musicSpaceId: 'space-1', ownerParticipantId: 'participant-owner',
    participants: [{ participantId: 'participant-owner', displayName: '微信用户', role: 'owner', online: false }],
    playback: { status: 'paused', basePositionSeconds: 0, serverTimestamp: '2026-08-31T00:00:00.000Z', revision: 0 },
    hardExpiresAt: '2026-08-31T08:00:00.000Z'
  } };
}
function flush(): Promise<void> { return new Promise((resolve) => setImmediate(resolve)); }
