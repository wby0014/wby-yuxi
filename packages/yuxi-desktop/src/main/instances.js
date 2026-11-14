'use strict';

const crypto = require('node:crypto');

/** 规范化实例 URL：补 https、去尾斜杠、只允许 http(s)。返回 { url } 或 { error }。 */
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return { error: '实例地址不能为空' };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { error: '仅支持 http/https 协议' };
  }
  let url = raw;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: '仅支持 http/https 协议' };
    }
    return { url: parsed.origin };
  } catch {
    return { error: '实例地址格式无效' };
  }
}

/** 校验并构造实例对象。返回 { instance } 或 { error }。 */
function validateInstance({ name, url }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return { error: '实例名称不能为空' };
  const normalized = normalizeUrl(url);
  if (normalized.error) return { error: normalized.error };
  return {
    instance: { id: crypto.randomUUID(), name: trimmedName, url: normalized.url },
  };
}

/** 内存态实例仓库：维护列表与当前实例 id，不负责持久化。 */
function createInstancesRepo(initial = { instances: [], currentId: null }) {
  let state = {
    instances: Array.isArray(initial.instances) ? initial.instances.slice() : [],
    currentId: initial.currentId || null,
  };

  return {
    list: () => state.instances.slice(),
    current: () => state.instances.find((i) => i.id === state.currentId) || null,
    add: (instance) => {
      state.instances.push(instance);
      if (!state.currentId) state.currentId = instance.id;
      return instance;
    },
    remove: (id) => {
      const exists = state.instances.some((i) => i.id === id);
      state.instances = state.instances.filter((i) => i.id !== id);
      if (state.currentId === id) {
        state.currentId = state.instances[0] ? state.instances[0].id : null;
      }
      return exists;
    },
    setCurrent: (id) => {
      if (!state.instances.some((i) => i.id === id)) return false;
      state.currentId = id;
      return true;
    },
    snapshot: () => ({ instances: state.instances.slice(), currentId: state.currentId }),
  };
}

module.exports = { normalizeUrl, validateInstance, createInstancesRepo };
