import type { MusicSpace } from '../types/music-space';
import { getUserEntitlements } from './user';
import {
  getHistoryForSpace,
  getLastPlayedSpace,
  isFavoriteSpace,
  recordPlayEvent,
  type PlayHistoryItem
} from './user-activity';
import {
  captureSessionScope,
  isSessionScopeCurrent,
  type SessionScope
} from './session-scope';

export type OptionalPersonalState = 'anonymous' | 'loaded' | 'unavailable' | 'stale';

export interface OptionalLastPlayedResult {
  state: OptionalPersonalState;
  scope: SessionScope;
  space?: MusicSpace;
  history?: PlayHistoryItem;
}

export interface OptionalPlayerPersonalResult {
  state: OptionalPersonalState;
  scope: SessionScope;
  favorite: boolean;
  lockedByMembership: boolean;
  history?: PlayHistoryItem;
}

export async function loadOptionalLastPlayed(): Promise<OptionalLastPlayedResult> {
  const scope = captureSessionScope();
  if (!scope.authenticated) return { state: 'anonymous', scope };
  try {
    const result = await getLastPlayedSpace();
    if (!isSessionScopeCurrent(scope)) return { state: 'stale', scope };
    return { state: 'loaded', scope, ...result };
  } catch {
    return { state: isSessionScopeCurrent(scope) ? 'unavailable' : 'stale', scope };
  }
}

export async function loadOptionalPlayerPersonalState(space: MusicSpace): Promise<OptionalPlayerPersonalResult> {
  const scope = captureSessionScope();
  const fallback = {
    scope,
    favorite: false,
    lockedByMembership: Boolean(space.isMemberOnly)
  };
  if (!scope.authenticated) return { state: 'anonymous', ...fallback };

  const [entitlements, favorite, history] = await Promise.allSettled([
    getUserEntitlements(),
    isFavoriteSpace(space.id),
    space.contentForm === 'silent-companion' ? Promise.resolve(undefined) : getHistoryForSpace(space.id)
  ]);
  if (!isSessionScopeCurrent(scope)) return { state: 'stale', ...fallback };

  return {
    state: [entitlements, favorite, history].some((item) => item.status === 'rejected') ? 'unavailable' : 'loaded',
    scope,
    favorite: favorite.status === 'fulfilled' ? favorite.value : false,
    lockedByMembership: Boolean(
      space.isMemberOnly && !(entitlements.status === 'fulfilled' && entitlements.value.canPlayMemberOnly)
    ),
    history: history.status === 'fulfilled' ? history.value : undefined
  };
}

export async function recordPlayEventForSession(
  scope: SessionScope | undefined,
  space: MusicSpace,
  currentTime: number,
  completed = false
): Promise<'recorded' | 'skipped' | 'stale'> {
  if (!scope?.authenticated) return 'skipped';
  if (!isSessionScopeCurrent(scope)) return 'stale';
  await recordPlayEvent(space, currentTime, completed);
  return isSessionScopeCurrent(scope) ? 'recorded' : 'stale';
}
