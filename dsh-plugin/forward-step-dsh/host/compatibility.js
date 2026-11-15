const compatibilityFields = ['exeSha256', 'cliVersion', 'profile', 'pluginRoot']

export function checkCompatibility(expected, actual) {
  const differences = compatibilityFields
    .filter((field) => expected?.[field] !== actual?.[field])
    .map((field) => ({
      field,
      expected: expected?.[field],
      actual: actual?.[field],
    }))

  return {
    ok: differences.length === 0,
    differences,
  }
}
