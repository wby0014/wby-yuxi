'use strict';

const media = window.matchMedia('(prefers-color-scheme: dark)');
/** 原生小页跟随系统主题，并复用 Web 颜色变量。 */
function applyTheme() { document.documentElement.classList.toggle('dark', media.matches); }
applyTheme();
media.addEventListener('change', applyTheme);
