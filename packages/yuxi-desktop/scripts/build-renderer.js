'use strict';

const path = require('node:path');
const { buildRenderer } = require('../../../scripts/desktop/build-renderer.cjs');

buildRenderer(path.resolve(__dirname, '..'), 'electron');
