import type { TenantRoleName } from '@standing/shared';

/** Manager or owner: may create venues and events. */
export const canManage = (role: TenantRoleName): boolean => role === 'owner' || role === 'manager';
/** Owner only: members and roles. */
export const canAdmin = (role: TenantRoleName): boolean => role === 'owner';

export function roleLabel(role: TenantRoleName): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'manager':
      return 'Manager';
    case 'door':
      return 'Door staff';
    default: {
      const never: never = role;
      return never;
    }
  }
}

/** The remembered tenant if it is still in the list, else the first, else null. */
export function pickDefaultTenant(tenants: readonly { id: string }[], stored?: string | null): string | null {
  if (stored && tenants.some((t) => t.id === stored)) return stored;
  return tenants[0]?.id ?? null;
}

const STORAGE_KEY = 'standing.tenant';

export function readStoredTenant(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeTenant(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable: the tenant is simply not remembered */
  }
}
