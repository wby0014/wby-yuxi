/** 按读取需求拉取原生响应块，保留 Response、背压和 AbortSignal 语义。 */
export async function nativeStreamFetch(core, path, options = {}) {
  const signal = options.signal
  signal?.throwIfAborted()
  const headers = new Headers(options.headers)
  let bytes = null
  if (options.body != null) {
    const encoded = new Response(options.body)
    if (!headers.has('content-type') && encoded.headers.has('content-type')) {
      headers.set('content-type', encoded.headers.get('content-type'))
    }
    bytes = [...new Uint8Array(await encoded.arrayBuffer())]
    signal?.throwIfAborted()
  }
  const id = crypto.randomUUID()
  let controller
  let finished = false
  let rejectAbort
  const aborted = new Promise((_, reject) => { rejectAbort = reject })
  const cleanup = () => {
    finished = true
    signal?.removeEventListener('abort', abort)
  }
  const cancel = () => core.invoke('stream_cancel', { id }).catch(() => {})
  const abort = () => {
    const error = signal.reason || new DOMException('请求已取消', 'AbortError')
    if (finished) return
    cleanup()
    controller?.error(error)
    rejectAbort(error)
    void cancel()
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const opening = core.invoke('stream_open', {
      id, path, method: options.method || 'GET', body: bytes, headers: Object.fromEntries(headers)
    })
    // abort 可能早于原生注册请求；迟到的响应也必须释放。
    opening.then(() => { if (signal?.aborted) void cancel() }, () => {})
    const head = await Promise.race([opening, aborted])
    const body = new ReadableStream({
      start(value) { controller = value },
      async pull(value) {
        try {
          const chunk = await core.invoke('stream_read', { id })
          if (finished) return
          if (chunk === null) {
            cleanup()
            value.close()
          } else value.enqueue(new Uint8Array(chunk))
        } catch (error) {
          if (!finished) {
            cleanup()
            value.error(new Error(String(error)))
          }
          void cancel()
        }
      },
      cancel() { cleanup(); return cancel() }
    }, { highWaterMark: 0 })
    if ([204, 205, 304].includes(head.status) || options.method?.toUpperCase() === 'HEAD') {
      cleanup()
      await cancel()
      return new Response(null, head)
    }
    return new Response(body, head)
  } catch (error) {
    cleanup()
    void cancel()
    throw error instanceof Error ? error : new Error(String(error))
  }
}
