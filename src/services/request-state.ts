import { ApiRequestError } from './network';

export type RequestViewState =
  | 'ready'
  | 'loading'
  | 'retrying'
  | 'empty'
  | 'error'
  | 'not-found'
  | 'stale'
  | 'recovered';

export interface ResolveRequestStateInput {
  value?: unknown;
  error?: unknown;
  detail?: boolean;
  loading?: boolean;
  retrying?: boolean;
  recovered?: boolean;
  hasCachedData?: boolean;
}

export function resolveRequestState(input: ResolveRequestStateInput): RequestViewState {
  if (input.loading) return 'loading';
  if (input.retrying) return 'retrying';
  if (input.error) {
    if (input.hasCachedData) return 'stale';
    if (input.detail && input.error instanceof ApiRequestError && input.error.statusCode === 404) return 'not-found';
    return 'error';
  }
  if (input.detail && input.value === undefined) return 'not-found';
  if (Array.isArray(input.value) && input.value.length === 0) return 'empty';
  if (input.recovered) return 'recovered';
  return 'ready';
}