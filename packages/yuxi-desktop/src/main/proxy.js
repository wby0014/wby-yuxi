'use strict';

/** 请求路径分类，与生产 nginx 的 location 规则一一对应。 */
function classifyPath(pathname) {
  if (pathname.startsWith('/api/')) return { kind: 'api' };
  if (pathname.startsWith('/minio/public/')) return { kind: 'minio' };
  return { kind: 'static' };
}

/** 构造转发到实例的完整 URL（baseUrl 已规范化、无尾斜杠）。 */
function buildForwardUrl(baseUrl, pathname, search) {
  return `${baseUrl}${pathname}${search || ''}`;
}

module.exports = { classifyPath, buildForwardUrl };
