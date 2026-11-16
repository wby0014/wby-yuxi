'use strict';

const api = window.yuxiDesktop;
const message = document.getElementById('message');
const retry = document.getElementById('retry');

/** 从主进程读取本次连接失败与实例信息。 */
async function render() {
  const state = await api.status();
  document.title = `连接 ${state.build.productName}`;
  document.getElementById('title').textContent = state.instance ? '暂时无法连接' : `欢迎使用 ${state.build.productName}`;
  document.getElementById('instance').textContent = state.instance ? `${state.instance.name} · ${state.instance.url}` : '';
  message.textContent = state.message;
  document.getElementById('version').textContent = `桌面端 ${state.build.desktopVersion} · 界面 ${state.build.webVersion}`;
  retry.hidden = !state.instance;
}

document.getElementById('settings').onclick = () => api.openSettings().catch((error) => { message.textContent = error.message; });
retry.onclick = async () => {
  retry.disabled = true;
  message.textContent = '正在连接…';
  try { await api.retry(); } catch (error) { message.textContent = error.message; retry.disabled = false; }
};
render().catch((error) => { message.textContent = error.message; });
