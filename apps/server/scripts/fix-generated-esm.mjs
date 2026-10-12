// Post-`prisma generate` codemod: prisma-zod-generator emits extensionless
// relative imports (`from './User.pure'`), which fail under the shared
// package's `moduleResolution: nodenext`. Rewrites every relative specifier to
// an explicit `.js` (file) or `/index.js` (directory) path.
//
// Idempotent: a specifier that already carries an extension is left alone.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN_ROOT = resolve(HERE, '../../../packages/shared/src/generated/zod');

if (!existsSync(GEN_ROOT)) {
  console.error(`[fix-generated-esm] generated dir not found: ${GEN_ROOT}`);
  process.exit(1);
}

/** @param {string} dir @returns {string[]} */
function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

// `from '<rel>'` and side-effect `import '<rel>'` with a relative specifier.
const IMPORT_RE = /(\bfrom\s+|\bimport\s+)(['"])(\.[^'"]+?)\2/g;

let changed = 0;
for (const file of collect(GEN_ROOT)) {
  const source = readFileSync(file, 'utf8');
  const next = source.replace(IMPORT_RE, (full, keyword, quote, specifier) => {
    if (specifier.endsWith('.js') || specifier.endsWith('.json')) return full;
    const absolute = resolve(dirname(file), specifier);
    const fixed =
      !existsSync(`${absolute}.ts`) && existsSync(absolute) && statSync(absolute).isDirectory()
        ? `${specifier}/index.js`
        : `${specifier}.js`;
    return `${keyword}${quote}${fixed}${quote}`;
  });
  if (next !== source) {
    writeFileSync(file, next);
    changed++;
  }
}
console.log(`[fix-generated-esm] rewrote relative imports in ${changed} file(s)`);
