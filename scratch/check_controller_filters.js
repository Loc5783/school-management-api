'use strict';

const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, '../backend/src/controllers');
const files = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));

const withFilter = [];
const withoutFilter = [];

files.forEach(file => {
  const content = fs.readFileSync(path.join(controllersDir, file), 'utf8');
  if (content.includes('tenantFilterService') || content.includes('buildTenantFilter') || content.includes('applyTenantFilter')) {
    withFilter.push(file);
  } else {
    withoutFilter.push(file);
  }
});

console.log('Controllers WITH tenantFilterService (' + withFilter.length + '):');
withFilter.forEach(f => console.log('  +' , f));

console.log('\nControllers WITHOUT tenantFilterService (' + withoutFilter.length + '):');
withoutFilter.forEach(f => console.log('  -' , f));
