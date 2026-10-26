const { existsSync, lstatSync, readFileSync, realpathSync } = require('node:fs');
const { join, resolve } = require('node:path');

const monorepoVerifier = resolve(__dirname, '../../../tools/verify-feedback-catalog.cjs');
if (existsSync(monorepoVerifier) && realpathSync(monorepoVerifier) !== realpathSync(__filename)) {
  require(monorepoVerifier);
  if (process.exitCode) process.exit(process.exitCode);
} else {
  verifySoloClone(resolve(__dirname, '..'));
}

function verifySoloClone(root) {
  const checks = [
    ['src/shared/feedback-catalog.generated.ts', 'FEEDBACK_CATALOG_GENERATED_INVALID', 'FEEDBACK_CATALOG_VERIFIED'],
    ['src/shared/scene-taxonomy.generated.ts', 'SCENE_TAXONOMY_GENERATED_INVALID', 'SCENE_TAXONOMY_VERIFIED']
  ];
  for (const [relativePath, code, label] of checks) {
    const file = join(root, relativePath);
    let stat;
    try { stat = lstatSync(file); } catch { fail(code); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 32) fail(code);
    if (!readFileSync(file, 'utf8').includes('export ')) fail(code);
    process.stdout.write(`${label} solo-clone\n`);
  }
}

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}
