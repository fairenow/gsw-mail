/** Shared scope evaluation for native AI and MCP, without transport policy. */
export function firstDisabledCapabilityScope(
  required: readonly string[],
  enabled: (scope: string) => boolean,
): string | undefined {
  return required.find(scope => !enabled(scope));
}

export function firstMissingCapabilityGrant(
  required: readonly string[],
  granted: ReadonlySet<string>,
): string | undefined {
  return required.find(scope => !granted.has(scope));
}
