'use strict';

/** 去掉 net.fetch 会自行设置的传输层头，避免转发冲突。 */
function forwardHeaders(headers) {
  const out = {};
  // request.headers 是 WHATWG Headers（可迭代对象），不是普通对象，必须用 for...of 迭代。
  for (const [k, v] of headers) {
    if (k === 'host' || k === 'content-length' || k === 'connection') continue;
    out[k] = v;
  }
  return out;
}

module.exports = { forwardHeaders };
