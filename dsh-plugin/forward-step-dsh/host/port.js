const requiredMethods = [
  'requestModel',
  'registerPanel',
  'exposeService',
  'getContext',
  'subscribe',
]

export function validateHostPort(port) {
  for (const name of requiredMethods) {
    if (typeof port?.[name] !== 'function') {
      throw Object.assign(new Error(`宿主能力缺失: ${name}`), {
        code: 'unsupported_host',
      })
    }
  }

  return port
}
