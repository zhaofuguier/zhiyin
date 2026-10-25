import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerContentLoader } from '../src/services/player-content-loader.ts';
import type { MusicSpace } from '../src/types/music-space.ts';
import type { OptionalPlayerPersonalResult } from '../src/services/personal-content.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function space(id: string): MusicSpace {
  return {
    id,
    title: id,
    atmosphereText: '专注',
    durationSeconds: 180,
    audioUrl: `https://media.example.test/${id}.mp3`,
    coverImageUrl: `https://media.example.test/${id}.jpg`,
    visualType: 'image',
    tags: ['专注'],
    isFeatured: false,
    isMemberOnly: false,
    playCount: 0,
    favoriteCount: 0,
    completionRate: 0
  };
}

function personal(): OptionalPlayerPersonalResult {
  return {
    state: 'anonymous',
    scope: { authenticated: false },
    favorite: false,
    lockedByMembership: false
  };
}

for (const staleOutcome of ['success', 'not-found', 'error'] as const) {
  test(`slow A ${staleOutcome} has zero side effects after fast B starts playback`, async () => {
    const a = deferred<MusicSpace | undefined>();
    const b = deferred<MusicSpace | undefined>();
    const state = { contentId: '', progress: 0, audioId: '', resets: 0, errors: 0, notFound: 0 };
    const loader = new PlayerContentLoader(
      {
        getDetail: (id) => id === 'A' ? a.promise : b.promise,
        getNext: async () => [],
        getPersonal: async () => personal()
      },
      {
        applyDetail(value) {
          state.contentId = value.id;
          state.progress = 0;
          state.audioId = value.audioUrl || '';
          state.resets += 1;
        },
        applyNotFound() { state.notFound += 1; },
        applyError() { state.errors += 1; },
        applyNext() {},
        applyPersonal() {}
      }
    );

    const loadA = loader.load('A');
    const loadB = loader.load('B');
    b.resolve(space('B'));
    assert.equal(await loadB, 'applied');
    state.progress = 47;
    const before = { ...state };

    if (staleOutcome === 'success') a.resolve(space('A'));
    else if (staleOutcome === 'not-found') a.resolve(undefined);
    else a.reject(new Error('A_FAILED'));

    assert.equal(await loadA, 'stale');
    assert.deepEqual(state, before);
    assert.equal(state.contentId, 'B');
    assert.equal(state.progress, 47);
    assert.equal(state.audioId, 'https://media.example.test/B.mp3');
  });
}

test('invalidated detail, recommendation and personal responses cannot mutate an exited page', async () => {
  const detail = deferred<MusicSpace | undefined>();
  const effects: string[] = [];
  const loader = new PlayerContentLoader(
    {
      getDetail: async () => detail.promise,
      getNext: async () => [space('next')],
      getPersonal: async () => personal()
    },
    {
      applyDetail: () => effects.push('detail'),
      applyNotFound: () => effects.push('not-found'),
      applyError: () => effects.push('error'),
      applyNext: () => effects.push('next'),
      applyPersonal: () => effects.push('personal')
    }
  );
  const pending = loader.load('A');
  loader.invalidate();
  detail.resolve(space('A'));
  assert.equal(await pending, 'stale');
  await Promise.resolve();
  assert.deepEqual(effects, []);
});

test('recommendation and personal responses from an earlier applied content cannot overwrite a later content', async () => {
  const nextA = deferred<MusicSpace[]>();
  const personalA = deferred<OptionalPlayerPersonalResult>();
  const applied = { contentId: '', nextFor: '', personalFor: '' };
  const loader = new PlayerContentLoader(
    {
      getDetail: async (id) => space(id),
      getNext: (id) => id === 'A' ? nextA.promise : Promise.resolve([]),
      getPersonal: (value) => value.id === 'A' ? personalA.promise : Promise.resolve(personal())
    },
    {
      applyDetail: (value) => { applied.contentId = value.id; },
      applyNotFound() {},
      applyError() {},
      applyNext: (id) => { applied.nextFor = id; },
      applyPersonal: (id) => { applied.personalFor = id; }
    }
  );
  assert.equal(await loader.load('A'), 'applied');
  assert.equal(await loader.load('B'), 'applied');
  await Promise.resolve();
  const before = { ...applied };
  nextA.resolve([space('A-next')]);
  personalA.resolve(personal());
  await Promise.all([nextA.promise, personalA.promise]);
  await Promise.resolve();
  assert.deepEqual(applied, before);
  assert.equal(applied.contentId, 'B');
});
