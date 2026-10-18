import { describe, expect, it } from 'vitest';
import { navItems, safeNext } from './nav';

const labels = (me: Parameters<typeof navItems>[0]) => navItems(me).map((i) => i.label);

describe('navItems', () => {
  it('shows Events only to anonymous visitors', () => {
    expect(labels(null)).toEqual(['Events']);
  });
  it('adds My orders for a signed-in buyer', () => {
    expect(labels({ tenants: 0, door: false })).toEqual(['Events', 'My orders']);
  });
  it('adds Organizer for a tenant member', () => {
    expect(labels({ tenants: 1, door: false })).toEqual(['Events', 'My orders', 'Organizer']);
  });
  it('adds only Door for a door-only member', () => {
    expect(labels({ tenants: 0, door: true })).toEqual(['Events', 'My orders', 'Door']);
  });
  it('adds Door for door staff', () => {
    expect(labels({ tenants: 1, door: true })).toEqual(['Events', 'My orders', 'Organizer', 'Door']);
  });
});

describe('safeNext', () => {
  it('keeps same-origin paths and rejects everything else', () => {
    expect(safeNext('/events/1?x=2')).toBe('/events/1?x=2');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('/\t/evil.com')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
