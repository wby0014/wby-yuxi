'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildRenderer } = require('../../../scripts/desktop/build-renderer.cjs');

const directory = path.resolve(__dirname, '..');
const build = buildRenderer(directory, 'tauri');
fs.writeFileSync(path.join(directory, 'src-tauri/tauri.generated.json'), JSON.stringify({
  productName: build.productName,
}, null, 2) + '\n');
