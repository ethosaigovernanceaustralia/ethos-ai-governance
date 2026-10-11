'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const file of fs.readdirSync(path.join(root, 'api', '_routes')).filter(f => f.endsWith('.js'))) {
  const exported = require(path.join(root, 'api', '_routes', file));
  if (!file.startsWith('_') && typeof exported !== 'function') throw new Error(`Invalid handler: ${file}`);
}
if (typeof require(path.join(root, 'api', '[route].js')) !== 'function') throw new Error('Invalid dispatcher');
console.log('All API modules imported successfully; no handlers invoked.');
