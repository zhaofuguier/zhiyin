import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedbackSessionState } from '../src/services/feedback-session-state.ts';

test('feedback page refreshes authentication when returning from login', () => {
  let token: string | undefined;
  const state = new FeedbackSessionState(() => token);

  assert.equal(state.refresh(), false);
  token = 'new-session-token';
  assert.equal(state.refresh(), true);
  assert.equal(state.authenticated, true);
});
