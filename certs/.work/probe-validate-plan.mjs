import { validateDSL } from '../../dist/src/domain/validator.js';
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('docs/task-system-plan.dsl.json', 'utf8'));
const r = validateDSL(d);
console.log('valid =', r.valid);
const list = (r.errors || []).concat(r.warnings || []);
console.log('问题数 =', list.length);
for (const p of list.slice(0, 8)) console.log(' -', JSON.stringify(p).slice(0, 170));
