'use strict';

const { readProductName } = require('./scripts/brand-config');

module.exports = {
  appId: 'com.yuxi.desktop',
  productName: readProductName(),
  electronDist: 'node_modules/electron/dist',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'renderer/**/*', 'package.json', '!**/*.map'],
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.productivity', identity: null, notarize: false },
};
