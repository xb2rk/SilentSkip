/** Code-unit string compare — deterministic across platforms, locales and ICU versions. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
