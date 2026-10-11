'use strict';

const fs = require('node:fs');
const path = require('node:path');
const publicFiles = require('./public-files.json');

function buildPublic(root, output = path.join(root, 'dist')) {
  // Only a fixed build directory may be removed. Refuse a symlink destination.
  if (path.resolve(output) !== path.resolve(root, 'dist')) throw new Error('Invalid output directory');
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('Symlink output refused');
  const inputs = publicFiles.map(relative => {
    if (path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) {
      throw new Error('Invalid public path');
    }
    let source = root;
    for (const part of relative.split('/')) {
      source = path.join(source, part);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Symlink input refused');
    }
    if (!fs.statSync(source).isFile()) throw new Error('Public input is not a file');
    return { source, relative };
  });
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const { source, relative } of inputs) {
    const target = path.join(output, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return inputs.length;
}

if (require.main === module) console.log(`Built ${buildPublic(path.resolve(__dirname, '..'))} public files`);
module.exports = { buildPublic };
