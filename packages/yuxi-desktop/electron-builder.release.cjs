'use strict';

module.exports = {
  extends: './electron-builder.yml',
  forceCodeSigning: true,
  mac: { identity: process.env.CSC_NAME, hardenedRuntime: true, notarize: true },
};
