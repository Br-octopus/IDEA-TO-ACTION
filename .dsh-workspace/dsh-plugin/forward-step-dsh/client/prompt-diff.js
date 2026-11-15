function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function comparePromptVersions(prompts, leftId, rightId) {
  const left = prompts?.find(item => item.id === leftId)
  const right = prompts?.find(item => item.id === rightId)
  if (!left || !right) fail('not_found', '待比较的提示词版本不存在')
  if (left.groupId !== right.groupId) fail('invalid_input', '只能比较同一提示词组内的版本')
  const before = String(left.text ?? '').split('\n')
  const after = String(right.text ?? '').split('\n')
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1
  return {
    left: { id: left.id, version: left.version, title: left.title },
    right: { id: right.id, version: right.version, title: right.title },
    unchangedPrefix: before.slice(0, prefix),
    removed: before.slice(prefix, before.length - suffix),
    added: after.slice(prefix, after.length - suffix),
    unchangedSuffix: suffix ? before.slice(before.length - suffix) : [],
  }
}
