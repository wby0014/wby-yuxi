'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyPath, buildForwardUrl } = require('./proxy');
const { forwardHeaders } = require('./headers');
const { isAppUrl } = require('./security');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

/** 将窗口请求绑定到创建时的实例，保留流、认证与取消语义。 */
function createProtocolHandler({ rendererDir, instance, fetch, signal }) {
  const instanceUrl = instance?.url;
  return async (request) => {
    if (!isAppUrl(request.url)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    const localFiles = {
      '/__desktop/status': path.join(__dirname, '../status/index.html'),
      '/__desktop/status.js': path.join(__dirname, '../status/status.js'),
      '/__desktop/style.css': path.join(__dirname, '../settings/style.css'),
      '/__desktop/settings': path.join(__dirname, '../settings/index.html'),
      '/__desktop/settings.js': path.join(__dirname, '../settings/settings.js'),
      '/__desktop/theme.js': path.join(__dirname, '../settings/theme.js'),
    };
    const decision = localFiles[url.pathname]
      ? { action: 'file', filePath: localFiles[url.pathname] }
      : routeRequest(url.pathname, url.search, { instanceUrl, rendererDir });
    if (decision.action === 'forward') {
      if (!instanceUrl) return Response.json({ detail: '请先配置实例' }, { status: 503 });
      const signals = [request.signal, signal].filter(Boolean);
      const init = {
        method: request.method, headers: forwardHeaders(request.headers),
        signal: AbortSignal.any(signals),
      };
      if (request.body) Object.assign(init, { body: request.body, duplex: 'half' });
      try {
        return await fetch(decision.url, init);
      } catch {
        return Response.json({ detail: init.signal.aborted ? '请求已取消' : '无法连接实例，请检查网络或实例设置' }, { status: 502 });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    try {
      const data = await fs.promises.readFile(decision.filePath);
      return new Response(request.method === 'HEAD' ? null : data, {
        headers: {
          'Content-Type': MIME[path.extname(decision.filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
}

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

module.exports = { routeRequest, createProtocolHandler };
