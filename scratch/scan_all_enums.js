'use strict';

const fs = require('fs');
const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      scanDir(full);
    } else if (f.endsWith('.js')) {
      const M = require(full);
      if (M && M.schema) {
        M.schema.eachPath((pathname, schematype) => {
          if (schematype.enumValues && schematype.enumValues.length > 0) {
            console.log(`${M.modelName}.${pathname}: [${schematype.enumValues.join(', ')}]`);
          }
        });
      }
    }
  });
}

scanDir(path.join(__dirname, '../backend/src/models'));
