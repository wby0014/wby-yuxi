<script setup>
import DesktopConnection from '@/components/desktop/DesktopConnection.vue'
import { isDesktop, getDesktopState } from '@/platform/runtime'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useAgentStore } from '@/stores/agent'
import { useUserStore } from '@/stores/user'
import { useThemeStore } from '@/stores/theme'
import { onMounted } from 'vue'

const desktopState = getDesktopState()
const agentStore = useAgentStore()
const userStore = useUserStore()
const themeStore = useThemeStore()

onMounted(async () => {
  if (userStore.isLoggedIn) {
    await agentStore.initialize()
  }
})
</script>
<template>
  <a-config-provider :theme="themeStore.currentTheme" :locale="zhCN">
    <DesktopConnection v-if="isDesktop && !desktopState.serverUrl" />
    <template v-else>
      <router-view />
      <DesktopConnection v-if="isDesktop" compact />
    </template>
  </a-config-provider>
</template>
