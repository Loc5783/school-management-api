'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.resolve('backend/src/saas/routes');
for (const f of fs.readdirSync(dir)) {
  if (f.startsWith('school')) {
    const c = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`\n=== ${f} ===`);
    const lines = c.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('router.') && (line.includes('get(') || line.includes('post(') || line.includes('put(') || line.includes('patch(') || line.includes('delete('))) {
        let block = line;
        for (let j = 1; j <= 5 && i + j < lines.length; j++) {
          block += ' ' + lines[i + j];
          if (lines[i + j].includes(';')) break;
        }
        const m = block.match(/router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"](.*)/);
        if (m) {
          const method = m[1].toUpperCase();
          const route = m[2];
          const rest = m[3];
          const roleM = rest.match(/roleCheck\(\[([^\]]+)\]\)/);
          const roles = roleM ? roleM[1].replace(/['"\s]/g, '').split(',') : 'NO_ROLE_CHECK';
          console.log(`${method.padEnd(6)} ${route.padEnd(35)} -> ${Array.isArray(roles) ? roles.join(', ') : roles}`);
        }
      }
    }
  }
}
