/**
 * Builds a path from segments, encoding every one with encodeURIComponent so an id taken from the URL
 * ("..%2F..", "a/b", "?x") stays one path segment. Empty segments throw: a missing id must not silently
 * collapse into a different route.
 */
export function joinPath(...segments: readonly string[]): string {
  return segments
    .map((s) => {
      if (s === '') throw new Error('Empty path segment');
      return `/${encodeURIComponent(s)}`;
    })
    .join('');
}

/** `/tenants/<id>/...` API path. */
export const tenantApi = (tenantId: string, ...rest: string[]): string => joinPath('tenants', tenantId, ...rest);
/** `/org/<id>/...` page href. */
export const orgPath = (tenantId: string, ...rest: string[]): string => joinPath('org', tenantId, ...rest);
