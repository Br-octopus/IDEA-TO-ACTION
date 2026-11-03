import test from 'node:test'
import assert from 'node:assert/strict'
import { validateHostPort } from '../../dsh-plugin/forward-step-dsh/host/port.js'
import { checkCompatibility } from '../../dsh-plugin/forward-step-dsh/host/compatibility.js'

const requiredMethods = ['requestModel', 'registerPanel', 'exposeService', 'getContext', 'subscribe']
const completePort = () => Object.fromEntries(requiredMethods.map((name) => [name, () => {}]))
const fingerprint = () => ({
  exeSha256: 'exe-hash',
  cliVersion: '0.2.0-rc.2',
  profile: 'forward-step-test',
  pluginRoot: 'D:/workspace/dsh-plugin/forward-step-dsh',
})

test('缺少宿主能力时阻止启用', () => {
  assert.throws(() => validateHostPort({}), { code: 'unsupported_host' })
})

test('完整内部 HostPort 被接受且保持原对象', () => {
  const port = completePort()
  assert.equal(validateHostPort(port), port)
})

test('HostPort 报告具体缺失方法', () => {
  const port = completePort()
  delete port.requestModel
  assert.throws(
    () => validateHostPort(port),
    (error) => error.code === 'unsupported_host' && error.message.includes('requestModel'),
  )
})

test('匹配的宿主指纹通过', () => {
  const expected = fingerprint()
  assert.deepEqual(checkCompatibility(expected, { ...expected }), { ok: true, differences: [] })
})

test('程序、版本、profile 或插件路径变化阻断兼容性', () => {
  const expected = fingerprint()
  const actual = {
    ...expected,
    exeSha256: 'changed-exe-hash',
    cliVersion: '0.2.0-rc.3',
    profile: 'desktop',
    pluginRoot: 'D:/other/forward-step-dsh',
  }
  const result = checkCompatibility(expected, actual)
  assert.equal(result.ok, false)
  assert.deepEqual(result.differences.map(({ field }) => field), [
    'exeSha256', 'cliVersion', 'profile', 'pluginRoot',
  ])
})

test('未提供预期或实际字段也报告不兼容', () => {
  const expected = fingerprint()
  const actual = { ...expected }
  delete actual.pluginRoot
  const result = checkCompatibility(expected, actual)
  assert.equal(result.ok, false)
  assert.deepEqual(result.differences, [{
    field: 'pluginRoot',
    expected: expected.pluginRoot,
    actual: undefined,
  }])
})
