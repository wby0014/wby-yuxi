'use strict';

const { Menu } = require('electron');

/**
 * 构建应用菜单。实例列表由 repo 提供；切换后 index.js 会 rebuildMenu()。
 */
function buildMenu({ repo, onOpenSettings, onSwitchInstance }) {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '实例',
      submenu: [
        ...repo.list().map((inst) => ({
          label: inst.name,
          type: 'radio',
          checked: repo.current() && repo.current().id === inst.id,
          click: () => onSwitchInstance(inst.id),
        })),
        { type: 'separator' },
        { label: '打开设置…', click: onOpenSettings },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
