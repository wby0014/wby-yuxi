// 独立浏览器上下文；接口全部使用确定性对端，不访问用户登录态。
// prettier-ignore
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const base = 'http://localhost:5173'
  const productName = '团队 "知识" & 工作台'
  await page.addInitScript(() => { Math.random = () => 0 })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let json = {}
    if (path === '/api/system/info') {
      await new Promise((resolve) => setTimeout(resolve, 300))
      json = { success: true, data: {
        organization: { name: productName, logo: '/favicon.svg', avatar: '/favicon.svg' }, branding: { name: productName }, footer: {}
      }}
    }
    if (path === '/api/system/health') json = { status: 'ok' }
    if (path === '/api/auth/check-first-run') json = { first_run: false }
    if (path === '/api/auth/oidc/config') json = { enabled: false }
    if (path === '/api/auth/me') json = { id: 1, user_id: 1, uid: 'brand-test', username: 'Brand Test', role: 'user' }
    if (path === '/api/agent') json = { agents: [] }
    if (path === '/api/chat/threads' || path === '/api/projects') json = []
    return route.fulfill({ json })
  })
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: { stargazers_count: 0 } }))
  await page.goto(base)
  await page.locator('.logo-text').filter({ hasText: productName }).waitFor()
  check(await page.title() === productName, '首页标题没有读取产品名')
  await page.goto(`${base}/login`)
  await page.locator('.brand-main').filter({ hasText: productName }).waitFor()
  check(await page.locator('.brand-org').count() === 0, '相同组织名和产品名被重复展示')
  check(await page.title() === productName, '登录页标题没有读取产品名')
  await page.evaluate(() => localStorage.setItem('user_token', 'synthetic-brand-token'))
  await page.goto(`${base}/agent`)
  await page.locator('.start-screen h1').filter({ hasText: productName }).waitFor()
  check(await page.locator('.start-screen h1').textContent() === `你好，这里是${productName}`, '欢迎语仍使用固定品牌')
  check(await page.title() === productName, '工作区标题没有读取产品名')
  for (const scheme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate((scheme) => {
      localStorage.setItem('theme', scheme)
      localStorage.setItem('chat-ui-store', JSON.stringify({ sidebarCollapsed: false }))
    }, scheme)
    await page.reload()
    await page.locator('.start-screen h1').filter({ hasText: productName }).waitFor()
    await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, scheme === 'dark')
    check(await page.locator('.ant-message-error').count() === 0, '品牌页面出现接口错误提示')
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 })
      if (width === 375) {
        await page.getByRole('button', { name: '折叠侧边栏', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.app-layout > .header').getBoundingClientRect().width <= 53)
      }
      await page.screenshot({ path: `/tmp/yuxi-branding-web-${scheme}-${width}.png`, fullPage: true })
    }
  }
  return { productName, pages: ['home', 'login', 'agent'], schemes: ['light', 'dark'], widths: [1440, 375] }
}
