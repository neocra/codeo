import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTokensCss } from '../src/themes';

const out = fileURLToPath(new URL('../src/tokens.css', import.meta.url));
writeFileSync(out, buildTokensCss());
console.log(`wrote ${out}`);
