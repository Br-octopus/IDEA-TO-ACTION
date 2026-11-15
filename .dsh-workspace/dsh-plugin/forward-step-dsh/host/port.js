const requiredMethods = [
  'requestModel',
  'registerPanel',
  'exposeService',
  'getContext',
  'subscribe',
]

// 这是插件内部适配器契约，不代表 DSH 每个版本都实际提供这些能力。
const capabilityMethods = {
  storage: ['getContext'],
  model: ['requestModel'],
  search: ['search'],
  file: ['selectFile'],
  directory: ['selectDirectory'],
  panel: ['registerPanel'],
  service: ['exposeService'],
  lifecycle: ['subscribe', 'dispose'],
}

export function validateHostPort(port) {
  for (const name of requiredMethods) {
    if (typeof port?.[name] !== 'function') {
      throw Object.assign(new Error(`宿主能力缺失: ${name}`), {
        code: 'unsupported_host',
        capability: name,
      })
    }
  }

  return port
}

export function inspectHostCapabilities(port) {
  return Object.fromEntries(Object.entries(capabilityMethods).map(([capability, methods]) => {
    const missing = methods.filter((method) => typeof port?.[method] !== 'function')
    return [capability, {
      status: missing.length === 0 ? 'available' : 'unavailable',
      missing,
    }]
  }))
}

export async function invokeHostCapability(port, capability, method, args = [], { signal } = {}) {
  if (!Object.hasOwn(capabilityMethods, capability) || !capabilityMethods[capability].includes(method)) {
    throw Object.assign(new Error(`未登记的宿主能力: ${capability}.${method}`), { code: 'unsupported_host', capability })
  }
  if (signal?.aborted) throw Object.assign(new Error('宿主操作已取消'), { code: 'cancelled', capability })
  if (typeof port?.[method] !== 'function') {
    throw Object.assign(new Error(`宿主能力不可用: ${capability}.${method}`), { code: 'unsupported_host', capability })
  }

  let onAbort
  const cancelled = signal && new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error('宿主操作已取消'), { code: 'cancelled', capability }))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const operation = Promise.resolve().then(() => {
      if (signal?.aborted) throw Object.assign(new Error('宿主操作已取消'), { code: 'cancelled', capability })
      return port[method](...args, ...(signal ? [signal] : []))
    })
    return await (cancelled ? Promise.race([operation, cancelled]) : operation)
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
