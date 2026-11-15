<script setup>
import { ref } from 'vue'
import { Server, Settings2 } from '@lucide/vue'
import { configureServer, getDesktopState } from '@/platform/runtime'

const props = defineProps({ compact: { type: Boolean, default: false } })
const state = getDesktopState()
const opened = ref(false)
const serverUrl = ref(state.serverUrl)
const busy = ref(false)
const error = ref('')

/** 无效地址保持当前页面；成功切换由 main 销毁旧窗口并重新装配。 */
async function connect() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const changed = await configureServer(serverUrl.value.trim())
    if (!changed && props.compact) opened.value = false
  } catch {
    error.value = '无法保存地址。请使用 HTTPS 服务根地址（如 https://yuxi.example.com），本机调试可用 http://127.0.0.1:5050。'
  } finally { busy.value = false }
}
</script>

<template>
  <a-button v-if="compact" class="desktop-service-button" @click="opened = true" title="服务设置">
    <Settings2 :size="16" />
    服务设置
  </a-button>
  <component :is="compact ? 'a-modal' : 'main'" v-model:open="opened" :footer="null" title="Yuxi 服务设置" :class="{ 'desktop-connection': !compact }">
    <section class="connection-card" :class="{ 'in-modal': compact }">
      <div class="connection-heading">
        <span class="connection-icon"><Server :size="28" /></span>
        <div>
          <h1>{{ compact ? '连接设置' : '连接你的 Yuxi' }}</h1>
          <p>桌面体验，数据与 Agent 执行仍由你的服务管理。</p>
        </div>
      </div>
      <a-form layout="vertical" @submit="connect">
        <a-form-item label="服务地址" :validate-status="error ? 'error' : undefined">
          <a-input v-model:value="serverUrl" name="serverUrl" size="large" placeholder="https://yuxi.example.com" :disabled="busy" autocomplete="url" />
          <p class="connection-hint">填写部署的根地址，不含 /api。生产服务需启用 HTTPS。</p>
        </a-form-item>
        <a-alert v-if="error" class="connection-alert" type="error" show-icon :message="error" />
        <a-alert v-if="!state.secureStorageAvailable" class="connection-alert" type="warning" show-icon message="系统安全存储不可用：登录仅在本次应用运行期间保留。" />
        <a-alert v-if="compact" class="connection-alert" type="info" show-icon message="切换服务将退出登录并清除本客户端缓存和草稿，不会删除服务端数据。" />
        <a-button type="primary" html-type="submit" size="large" block :loading="busy" :disabled="!serverUrl.trim()">{{ compact ? '保存服务设置' : '保存并前往登录' }}</a-button>
      </a-form>
      <p class="connection-footnote">当前版本使用账号密码登录，不接入本地目录或命令执行。</p>
    </section>
  </component>
</template>

<style scoped>
.desktop-connection { min-height: 100vh; display: grid; place-items: center; padding: 40px 24px; background: var(--gray-10); color: var(--gray-900); }
.connection-card { width: min(540px, 100%); padding: 36px; border: 1px solid var(--gray-200); border-radius: 16px; background: var(--gray-0); box-shadow: 0 12px 40px var(--shadow-1); }
.connection-card.in-modal { width: 100%; padding: 12px 0 0; border: 0; box-shadow: none; background: transparent; }
.connection-heading { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
.connection-icon { display: grid; place-items: center; flex-shrink: 0; width: 56px; height: 56px; border-radius: 14px; color: var(--main-color); background: var(--main-50); }
.connection-heading h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; color: var(--gray-1000); }
.connection-heading p, .connection-hint, .connection-footnote { margin: 0; font-size: 13px; line-height: 1.7; color: var(--gray-600); }
.connection-hint { margin-top: 8px; }
.connection-alert { margin-bottom: 16px; }
.connection-footnote { margin-top: 20px; }
.desktop-service-button { position: fixed; right: 16px; bottom: 12px; z-index: 1050; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px var(--shadow-1); }
</style>
