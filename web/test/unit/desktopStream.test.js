import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { nativeStreamFetch } from '../../src/platform/stream.js'

test('收到响应头即可读取首块，后续数据按 reader 需求读取并保留 UTF-8 字节', async () => {
  const calls = []
  const chunks = [[...new TextEncoder().encode('首包')], [0, 255, 1], null]
  const core = { invoke: async (command, arguments_) => {
    calls.push({ command, ...arguments_ })
    if (command === 'stream_open') return { status: 200, headers: [['content-type', 'text/event-stream']] }
    if (command === 'stream_read') return chunks.shift()
  } }
  const response = await nativeStreamFetch(core, '/api/agent/runs/run/events?after=1', {
    headers: { Authorization: 'Bearer synthetic', 'Last-Event-ID': '1-0' }
  })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  assert.equal(calls.filter((call) => call.command === 'stream_read').length, 0)
  assert.equal(calls[0].path, '/api/agent/runs/run/events?after=1')
  assert.equal(calls[0].headers['last-event-id'], '1-0')
  const reader = response.body.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value), '首包')
  assert.equal(calls.filter((call) => call.command === 'stream_read').length, 1)
  assert.deepEqual([...((await reader.read()).value)], [0, 255, 1])
  assert.equal((await reader.read()).done, true)
})

test('AbortSignal 终止等待中的读取并取消对应原生请求', async () => {
  const cancelled = []
  const abort = new AbortController()
  const core = { invoke: async (command, { id }) => {
    if (command === 'stream_open') return { status: 200, headers: [] }
    if (command === 'stream_read') return new Promise(() => {})
    if (command === 'stream_cancel') cancelled.push(id)
  } }
  const response = await nativeStreamFetch(core, '/api/agent/runs/run/events', { signal: abort.signal })
  const reading = response.body.getReader().read()
  abort.abort()
  await assert.rejects(reading, (error) => error.name === 'AbortError')
  assert.equal(cancelled.length, 1)
})

test('请求头尚未返回时取消，迟到的原生响应也会被释放', async () => {
  let finish
  const cancelled = []
  const abort = new AbortController()
  const core = { invoke: async (command, { id }) => {
    if (command === 'stream_open') return new Promise((resolve) => { finish = resolve })
    if (command === 'stream_cancel') cancelled.push(id)
  } }
  const pending = nativeStreamFetch(core, '/api/agent/runs/run/events', { signal: abort.signal })
  abort.abort()
  await assert.rejects(pending, (error) => error.name === 'AbortError')
  const count = cancelled.length
  finish({ status: 200, headers: [] })
  await setImmediate()
  assert.ok(cancelled.length > count)
})

test('reader.cancel 释放原生响应，已取消的输入不创建网络请求', async () => {
  const commands = []
  const core = { invoke: async (command) => {
    commands.push(command)
    return { status: 200, headers: [] }
  } }
  const response = await nativeStreamFetch(core, '/api/agent/runs/run/events')
  await response.body.cancel()
  assert.deepEqual(commands, ['stream_open', 'stream_cancel'])
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(nativeStreamFetch(core, '/api/agent/runs/run/events', { signal: abort.signal }))
  assert.equal(commands.length, 2)
})

test('保留错误 HTTP 状态与 body，原生读取失败不会伪装成流正常结束', async () => {
  let chunks = [[...new TextEncoder().encode('{"detail":"unauthorized"}')], null]
  const core = { invoke: async (command) => {
    if (command === 'stream_open') return { status: 401, headers: [['content-type', 'application/json']] }
    if (command === 'stream_read') {
      if (!chunks) throw new Error('原生流已关闭')
      return chunks.shift()
    }
  } }
  const response = await nativeStreamFetch(core, '/api/agent/runs/run/events')
  assert.equal(response.ok, false)
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { detail: 'unauthorized' })
  chunks = null
  const failed = await nativeStreamFetch(core, '/api/agent/runs/run/events')
  await assert.rejects(failed.text(), /原生流已关闭/)
})

test('原生上传保留 multipart 字段、文件字节与 boundary，HEAD 返回无 body', async () => {
  let request
  const core = { invoke: async (command, arguments_) => {
    if (command === 'stream_open') { request = arguments_; return { status: 201, headers: [] } }
    if (command === 'stream_read') return null
  } }
  const form = new FormData()
  form.append('name', '测试附件')
  form.append('file', new Blob([new Uint8Array([0, 255, 123])]), 'sample.bin')
  const response = await nativeStreamFetch(core, '/api/attachments', { method: 'POST', body: form })
  assert.equal(request.method, 'POST')
  const decoded = await new Response(new Uint8Array(request.body), { headers: request.headers }).formData()
  assert.equal(decoded.get('name'), '测试附件')
  assert.equal(decoded.get('file').name, 'sample.bin')
  assert.deepEqual([...new Uint8Array(await decoded.get('file').arrayBuffer())], [0, 255, 123])
  await response.body.cancel()
  assert.equal((await nativeStreamFetch(core, '/api/example', { method: 'HEAD' })).body, null)
})
