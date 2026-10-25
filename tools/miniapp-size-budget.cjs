const fs = require('node:fs');
const path = require('node:path');

// Internal raw-output budgets, deliberately stricter than platform ceilings.
// Changes require a reviewed code change, not a build-time environment override.
const SIZE_BUDGET = Object.freeze({ main: 1536 * 1024, subpackage: 1536 * 1024, total: 8 * 1024 * 1024, staticFile: 256 * 1024 });

function assertProductionSizeBudget(root, platform) {
  if (!['mp-weixin', 'mp-toutiao'].includes(platform)) throw new Error('MINIAPP_SIZE_PLATFORM_INVALID');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const subpackages = app.subPackages ?? app.subpackages ?? [];
  if (!Array.isArray(subpackages)) throw new Error('MINIAPP_SUBPACKAGE_ROOT_INVALID');
  const roots = subpackages.map(item => item.root);
  for (const item of roots) {
    if (typeof item !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(item)) throw new Error('MINIAPP_SUBPACKAGE_ROOT_INVALID');
  }
  if (new Set(roots).size !== roots.length || roots.some(a => roots.some(b => a !== b && a.startsWith(b + '/')))) {
    throw new Error('MINIAPP_SUBPACKAGE_ROOT_INVALID');
  }
  const result = { mainBytes: 0, totalBytes: 0, subpackageBytes: Object.fromEntries(roots.map(key => [key, 0])), failures: [] };
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('MINIAPP_SIZE_LINK_REJECTED');
      if (entry.isDirectory()) { visit(full); continue; }
      if (!entry.isFile()) throw new Error('MINIAPP_SIZE_ENTRY_INVALID');
      const relative = path.relative(root, full).replaceAll('\\', '/');
      const bytes = fs.statSync(full).size;
      const owner = roots.find(key => relative.startsWith(key + '/'));
      result.totalBytes += bytes;
      if (owner) result.subpackageBytes[owner] += bytes;
      else result.mainBytes += bytes;
      if (/(^|\/)static\//.test(relative) && bytes > SIZE_BUDGET.staticFile) result.failures.push({ kind: 'static-file', file: relative, bytes });
    }
  }
  visit(root);
  if (result.mainBytes > SIZE_BUDGET.main) result.failures.push({ kind: 'main', bytes: result.mainBytes });
  if (result.totalBytes > SIZE_BUDGET.total) result.failures.push({ kind: 'total', bytes: result.totalBytes });
  for (const [name, bytes] of Object.entries(result.subpackageBytes)) {
    if (bytes > SIZE_BUDGET.subpackage) result.failures.push({ kind: 'subpackage', file: name, bytes });
  }
  if (result.failures.length) {
    const error = new Error('MINIAPP_SIZE_BUDGET_EXCEEDED');
    error.findings = result.failures;
    throw error;
  }
  return result;
}

module.exports = { SIZE_BUDGET, assertProductionSizeBudget };
