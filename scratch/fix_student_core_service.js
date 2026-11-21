const fs = require('fs');
let content = fs.readFileSync('backend/src/services/studentCoreService.js', 'utf8');
content = content.replace('{ $inc: { sequence: 1 }, $setOnInsert }', '{ $inc: { sequence: 1 }, $setOnInsert: setOnInsert }');
fs.writeFileSync('backend/src/services/studentCoreService.js', content, 'utf8');
console.log('Fixed studentCoreService.js');
