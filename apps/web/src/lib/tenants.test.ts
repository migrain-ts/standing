import { describe, expect, it } from 'vitest';
import { canAdmin, canManage, pickDefaultTenant, roleLabel } from './tenants';

const tenants = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('role helpers', () => {
  it('canManage is manager or owner', () => {
    expect(canManage('owner')).toBe(true);
    expect(canManage('manager')).toBe(true);
    expect(canManage('door')).toBe(false);
  });
  it('canAdmin is owner only', () => {
    expect(canAdmin('owner')).toBe(true);
    expect(canAdmin('manager')).toBe(false);
    expect(canAdmin('door')).toBe(false);
  });
  it('roleLabel is human readable', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('manager')).toBe('Manager');
    expect(roleLabel('door')).toBe('Door staff');
  });
});

describe('pickDefaultTenant', () => {
  it('honours a stored id that still exists', () => {
    expect(pickDefaultTenant(tenants, 'b')).toBe('b');
  });
  it('falls back to the first when the stored id is gone or absent', () => {
    expect(pickDefaultTenant(tenants, 'zzz')).toBe('a');
    expect(pickDefaultTenant(tenants)).toBe('a');
    expect(pickDefaultTenant(tenants, null)).toBe('a');
  });
  it('is null without tenants', () => {
    expect(pickDefaultTenant([], 'a')).toBeNull();
  });
});
