'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const assembleSaasApp = require('../backend/src/saas/assembleSaasApp');

const app = assembleSaasApp({ saasMode: 'phase1e' });

const routes = [];

function parseLayer(layer, basePath = '') {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
    routes.push({
      path: basePath + layer.route.path,
      methods
    });
  } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
    let routePrefix = '';
    if (layer.regexp) {
      const src = layer.regexp.source;
      const clean = src
        .replace('^\\', '')
        .replace('\\/?(?=\\/|$)', '')
        .replace(/\\\//g, '/')
        .replace(/\(\?=\\\/\|\$\)/g, '')
        .replace(/\/\?$/, '')
        .replace(/^\^/, '');
      routePrefix = clean;
    }
    layer.handle.stack.forEach(subLayer => {
      parseLayer(subLayer, basePath + routePrefix);
    });
  }
}

const stack = (app.router && app.router.stack) || (app._router && app._router.stack) || [];
stack.forEach(layer => parseLayer(layer));

console.log('Total routes found:', routes.length);
const sorted = routes.sort((a, b) => a.path.localeCompare(b.path));
sorted.forEach(r => {
  console.log(`${r.methods.join(',').padEnd(10)} ${r.path}`);
});
