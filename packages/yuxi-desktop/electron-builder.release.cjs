'use strict';

module.exports = {
  extends: './electron-builder.js',
  forceCodeSigning: true,
  mac: { identity: process.env.CSC_NAME, hardenedRuntime: true, notarize: true },
};
