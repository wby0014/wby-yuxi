'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyPath, buildForwardUrl } = require('./proxy');

/**
 * 决定一个 app:// 请求如何处理。
 * 返回 { action, ... }：
 *  - { action: 'forward', url }        转发到实例
 *  - { action: 'file', filePath }      返回 renderer 下静态文件
 *  - { action: 'fallback', filePath }  SPA 路由回退 index.html
 */
function routeRequest(pathname, search, { instanceUrl, rendererDir }) {
  const kind = classifyPath(pathname);
  if (kind.kind === 'api' || kind.kind === 'minio') {
    return { action: 'forward', url: buildForwardUrl(instanceUrl, pathname, search) };
  }

  // 静态资源：安全映射到 renderer 目录内，防目录穿越。
  let relative;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return { action: 'fallback', filePath: path.join(rendererDir, 'index.html') };
  }
  const candidate = path.join(rendererDir, relative);
  const isInside =
    candidate === rendererDir || candidate.startsWith(rendererDir + path.sep);
  if (isInside && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return { action: 'file', filePath: candidate };
  }

  return { action: 'fallback', filePath: path.join(rendererDir, 'index.html') };
}

module.exports = { routeRequest };
