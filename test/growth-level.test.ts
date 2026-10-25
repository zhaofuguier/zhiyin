import assert from 'node:assert/strict';
import test from 'node:test';
import { growthLevelLabel, normalizeGrowthLevelFields } from '../src/domain/growth-level.ts';

test('renders missing compatibility data as L1 初遇', () => {
  assert.deepEqual(normalizeGrowthLevelFields({}), { growthLevel: 1, growthLevelName: '初遇' });
  assert.equal(growthLevelLabel({}), 'L1 初遇');
});

test('uses the server supplied level and name without local progression calculation', () => {
  assert.equal(growthLevelLabel({ growthLevel: 8, growthLevelName: '守愿' }), 'L8 守愿');
});

test('normalizes only the two server-owned growth fields', () => {
  const profile = normalizeGrowthLevelFields({ growthLevel: 3, growthLevelName: '新叶' });
  assert.deepEqual(Object.keys(profile).sort(), ['growthLevel', 'growthLevelName']);
});
