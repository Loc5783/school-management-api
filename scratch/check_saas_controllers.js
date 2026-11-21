'use strict';

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../backend/src/saas/routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

const usedControllers = new Set();
const routeControllersMap = {};

files.forEach(file => {
  const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
  routeControllersMap[file] = [];
  const matches = content.matchAll(/require\(['"]\.\.\/\.\.\/controllers\/([^'"]+)['"]\)/g);
  for (const m of matches) {
    usedControllers.add(m[1]);
    routeControllersMap[file].push(m[1]);
  }
});

console.log('Controllers used by SaaS routes:');
Array.from(usedControllers).sort().forEach(c => console.log('  *', c));

console.log('\nBreakdown by route file:');
Object.entries(routeControllersMap).forEach(([r, list]) => {
  console.log(`\n${r}:`);
  list.forEach(c => console.log('  ->', c));
});
