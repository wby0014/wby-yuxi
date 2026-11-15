'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { windowBounds } = require('../src/main/window-state');

test('恢复可见窗口，断开显示器或损坏配置不会把窗口放到屏幕外', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-bounds-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'window.json');
  const displays = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];
  fs.writeFileSync(file, JSON.stringify({ x: 100, y: 100, width: 900, height: 600 }));
  assert.deepEqual(windowBounds(file, displays), { x: 100, y: 100, width: 900, height: 600 });
  fs.writeFileSync(file, JSON.stringify({ x: 2500, y: -300, width: 9000, height: 10 }));
  assert.deepEqual(windowBounds(file, displays), { width: 1440, height: 480 });
  fs.writeFileSync(file, 'invalid');
  assert.deepEqual(windowBounds(file, displays), { width: 1280, height: 800 });
});

test('合法 JSON 中的 null、标量和数组按缺省窗口配置恢复', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-bounds-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'window.json');
  const displays = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];
  for (const saved of [null, false, 42, 'window', []]) {
    fs.writeFileSync(file, JSON.stringify(saved));
    assert.deepEqual(windowBounds(file, displays), { width: 1280, height: 800 });
  }
});
