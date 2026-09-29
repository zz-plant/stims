import { buildFieldAliasMap } from './field-table.ts';

/**
 * Every spelling a preset may use for a field → the Stims key, or null for a
 * spelling Stims deliberately ignores. Derived from the field table so a new
 * field or spelling is added in one place.
 */
const aliasMap: Record<string, string | null> = buildFieldAliasMap();

export function normalizeFieldSuffix(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_');
}

export function normalizeProgramAssignmentTarget(target: string) {
  const normalizedTarget = normalizeFieldSuffix(target);
  const aliasedTarget = aliasMap[normalizedTarget];
  return aliasedTarget ?? normalizedTarget;
}

export function resolveMilkdropIdentifier(
  env: Record<string, number>,
  identifier: string,
) {
  const normalizedIdentifier = normalizeFieldSuffix(identifier);
  const aliasedIdentifier = aliasMap[normalizedIdentifier];

  return (
    env[identifier] ??
    env[normalizedIdentifier] ??
    (aliasedIdentifier ? env[aliasedIdentifier] : undefined)
  );
}

export { aliasMap };
