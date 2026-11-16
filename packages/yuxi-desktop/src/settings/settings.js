'use strict';

const api = window.settingsAPI;
const form = document.getElementById('instance-form');
const nameInput = document.getElementById('name');
const urlInput = document.getElementById('url');
const message = document.getElementById('message');
const error = document.getElementById('error');
const deleteDialog = document.getElementById('delete-dialog');
let editingId = null;
let deletingId = null;
let busy = false;

/** 所有设置操作共享等待与失败状态，避免重复提交。 */
async function perform(action) {
  if (busy) return;
  busy = true;
  error.textContent = '';
  message.textContent = '正在处理…';
  setDisabled();
  try { await action(); } catch (err) { error.textContent = err.message; } finally {
    busy = false;
    if (message.textContent === '正在处理…') message.textContent = '';
    setDisabled();
  }
}

/** 等待期间禁用表单及列表操作。 */
function setDisabled() {
  document.querySelectorAll('button, input').forEach((element) => { element.disabled = busy; });
}

/** 回到新增表单，保留页面中的错误反馈。 */
function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById('form-title').textContent = '添加实例';
  document.getElementById('save').textContent = '添加实例';
  document.getElementById('cancel-edit').hidden = true;
}

/** 从主进程重新读取当前事实，不依赖本地乐观状态。 */
async function render() {
  const state = await api.state();
  document.title = `${state.build.productName} 实例设置`;
  document.getElementById('intro').textContent = `添加本地或远程 ${state.build.productName} 服务。切换实例需要重新登录。`;
  const list = document.getElementById('list');
  list.replaceChildren();
  document.getElementById('empty').hidden = state.instances.length > 0;
  for (const instance of state.instances) {
    const row = document.createElement('li');
    const summary = document.createElement('div');
    summary.className = 'summary';
    const title = document.createElement('strong');
    title.textContent = `${instance.name}${instance.id === state.currentId ? ' · 当前' : ''}`;
    const address = document.createElement('span');
    address.className = 'muted address';
    address.textContent = instance.url;
    summary.append(title, address);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const use = document.createElement('button');
    use.textContent = '连接';
    use.onclick = () => perform(async () => { await api.switchInstance(instance.id); await render(); });
    const edit = document.createElement('button');
    edit.textContent = '编辑';
    edit.onclick = () => {
      editingId = instance.id;
      nameInput.value = instance.name;
      urlInput.value = instance.url;
      document.getElementById('form-title').textContent = '编辑实例';
      document.getElementById('save').textContent = '保存修改';
      document.getElementById('cancel-edit').hidden = false;
      nameInput.focus();
    };
    const remove = document.createElement('button');
    remove.textContent = '删除';
    remove.className = 'danger';
    remove.onclick = () => {
      deletingId = instance.id;
      document.getElementById('delete-description').textContent = `删除“${instance.name}”的连接配置？${instance.id === state.currentId ? '当前窗口将退出登录并连接剩余实例。' : ''}`;
      deleteDialog.showModal();
    };
    actions.append(use, edit, remove);
    row.append(summary, actions);
    list.append(row);
  }
  document.getElementById('version').textContent = `桌面端 ${state.build.desktopVersion} · 界面 ${state.build.webVersion}`;
  setDisabled();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  perform(async () => {
    if (editingId) await api.updateInstance(editingId, nameInput.value, urlInput.value);
    else await api.addInstance(nameInput.value, urlInput.value);
    resetForm();
    await render();
    message.textContent = '实例配置已保存';
  });
});
document.getElementById('cancel-edit').onclick = resetForm;
document.getElementById('check').onclick = () => perform(async () => {
  const result = await api.checkConnection(urlInput.value);
  if (!result.ok) throw new Error(result.message);
  message.textContent = result.message;
});
document.getElementById('cancel-delete').onclick = () => deleteDialog.close();
document.getElementById('confirm-delete').onclick = () => {
  deleteDialog.close();
  perform(async () => {
    await api.removeInstance(deletingId);
    if (editingId === deletingId) resetForm();
    await render();
    message.textContent = '实例连接配置已删除';
  });
};
api.onChanged(() => render().catch((err) => { error.textContent = err.message; }));
render().catch((err) => { error.textContent = err.message; });
