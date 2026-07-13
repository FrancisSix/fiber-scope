import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const directory of ['fixtures', 'public', 'src']) {
  fs.cpSync(path.join(root, directory), path.join(output, directory), { recursive: true });
}

fs.copyFileSync(path.join(root, 'public', 'index.html'), path.join(output, 'index.html'));
fs.writeFileSync(path.join(output, '.nojekyll'), '');

console.log(`Built static dashboard in ${path.relative(root, output)}`);
