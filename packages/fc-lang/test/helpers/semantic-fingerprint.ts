/** A parser-level comparison that ignores source positions and token indexes. */
export function semanticFingerprint(
  root: unknown,
  tokens: readonly { readonly text: string }[],
): string {
  return JSON.stringify(normalize(root, tokens));
}

function normalize(
  value: unknown,
  tokens: readonly { readonly text: string }[],
  parentKey?: string,
): unknown {
  if (value === undefined) return { undefined: true };
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item, tokens));
    return parentKey === "imports"
      ? items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : items;
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "range" || key === "tokenRange" || /token(?:Index|Indices)$/iu.test(key)) continue;
    result[key] = normalize(child, tokens, key);
  }
  if (record.kind === "literal-expression" && typeof record.tokenIndex === "number")
    result.literalText = tokens[record.tokenIndex]?.text;
  if (
    (record.kind === "library-import" || record.kind === "named-import") &&
    typeof record.pathTokenIndex === "number"
  ) {
    result.pathLiteralText = tokens[record.pathTokenIndex]?.text;
  }
  return result;
}
