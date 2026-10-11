'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadHandler(file, { env = {}, mocks = {}, fetch, append = '' } = {}) {
  const filename = file.startsWith('../lib/') ? path.join(root, file.slice(3)) : path.join(root, 'api', '_routes', file);
  const context = {
    module: { exports: {} }, Buffer, URL, AbortSignal,
    process: { env }, console: { log() {}, error() {}, warn() {} },
    fetch: fetch || (() => { throw new Error('Unexpected network call'); }),
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'crypto') return require('node:crypto');
      if (name.startsWith('../../lib/')) return loadHandler(`${name.slice(3)}.js`, { env, mocks, fetch });
      if (name.startsWith('./') && file.startsWith('../lib/')) return loadHandler(`../lib/${name.slice(2)}.js`, { env, mocks, fetch });
      throw new Error(`Unmocked dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + append, context, { filename, timeout: 1000 });
  return context.module.exports;
}

function response() {
  return { code: 200, body: undefined, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}
module.exports = { loadHandler, response, root };
