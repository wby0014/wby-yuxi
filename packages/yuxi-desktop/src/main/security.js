'use strict';

/** 只允许本地应用 origin，拒绝伪造 host 和 URL 凭据。 */
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === 'yuxi' && !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** 外部浏览器入口只接收无内嵌凭据的 HTTP(S) 地址。 */
function externalUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('仅允许打开 HTTP(S) 网页');
  }
  return url.href;
}

/** 在 IPC 副作用边界校验窗口身份、顶层 frame 和页面地址。 */
function assertSender(event, window, acceptsUrl) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !acceptsUrl(event.senderFrame.url)) {
    throw new Error('拒绝来自非可信页面的请求');
  }
}

module.exports = { isAppUrl, externalUrl, assertSender };
