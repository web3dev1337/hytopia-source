import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const srcPresets = path.join(pkgRoot, 'src', 'presets');
const distPresets = path.join(pkgRoot, 'dist', 'presets');

fs.mkdirSync(distPresets, { recursive: true });

for (const file of fs.readdirSync(srcPresets)) {
  if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

  fs.copyFileSync(
    path.join(srcPresets, file),
    path.join(distPresets, file),
  );
}

