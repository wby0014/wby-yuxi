'use strict';

/** 构建原生快捷键菜单与实例入口。 */
function buildMenu({ Menu, repo, onOpenSettings, onOpenMain, onSwitchInstance }) {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    {
      label: '实例',
      submenu: [
        { label: '打开主窗口', click: onOpenMain },
        { type: 'separator' },
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
