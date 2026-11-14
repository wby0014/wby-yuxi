'use strict';

const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');
const form = document.getElementById('add-form');

async function render() {
  const [instances, current] = await Promise.all([
    window.settingsAPI.listInstances(),
    window.settingsAPI.currentInstance(),
  ]);
  listEl.innerHTML = '';
  for (const inst of instances) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${inst.name} (${inst.url})${inst.id === (current && current.id) ? ' [当前]' : ''}`;

    const useBtn = document.createElement('button');
    useBtn.textContent = '使用';
    useBtn.onclick = async () => {
      const r = await window.settingsAPI.switchInstance(inst.id);
      showError(r.error);
      if (!r.error) render();
    };

    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.onclick = async () => {
      await window.settingsAPI.removeInstance(inst.id);
      render();
    };

    li.append(label, useBtn, delBtn);
    listEl.append(li);
  }
}

function showError(msg) {
  errorEl.textContent = msg || '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const url = document.getElementById('url').value;
  const r = await window.settingsAPI.addInstance(name, url);
  showError(r.error);
  if (!r.error) {
    form.reset();
    render();
  }
});

render();
