'use strict';

const fs = require('node:fs');

/** 恢复仍与当前显示器相交的窗口位置，移除已断开屏幕的坐标。 */
function windowBounds(file, displays) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { saved = {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const primary = displays[0].workArea;
  const width = Math.min(Math.max(Number.isFinite(saved.width) ? saved.width : 1280, 720), primary.width);
  const height = Math.min(Math.max(Number.isFinite(saved.height) ? saved.height : 800, 480), primary.height);
  const visible = Number.isFinite(saved.x) && Number.isFinite(saved.y) && displays.some(({ workArea: area }) =>
    saved.x >= area.x && saved.y >= area.y && saved.x + width <= area.x + area.width && saved.y + height <= area.y + area.height);
  return visible ? { width, height, x: saved.x, y: saved.y } : { width, height };
}

module.exports = { windowBounds };
