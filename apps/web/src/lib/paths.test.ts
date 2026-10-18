import { describe, expect, it } from 'vitest';
import { joinPath, orgPath, tenantApi } from './paths';

describe('joinPath', () => {
  it('joins plain segments', () => {
    expect(joinPath('tenants', 'abc', 'venues')).toBe('/tenants/abc/venues');
  });
  it('encodes slashes, dots-with-slashes, percent, query, hash, spaces and unicode', () => {
    expect(joinPath('a/b')).toBe('/a%2Fb');
    expect(joinPath('../..')).toBe('/..%2F..'.replace('..%2F..', '..' + '%2F' + '..'));
    expect(joinPath('..%2F..')).toBe('/..%252F..');
    expect(joinPath('x?y=1')).toBe('/x%3Fy%3D1');
    expect(joinPath('x#y')).toBe('/x%23y');
    expect(joinPath('a b')).toBe('/a%20b');
    expect(joinPath('é☃')).toBe('/%C3%A9%E2%98%83');
    expect(joinPath('%')).toBe('/%25');
  });
  it('never yields extra segments from a hostile id', () => {
    expect(joinPath('tenants', '../../auth/logout').split('/')).toHaveLength(3);
  });
  it('rejects empty segments', () => {
    expect(() => joinPath('tenants', '')).toThrow('Empty path segment');
  });
});

describe('tenantApi and orgPath', () => {
  it('prefix and encode', () => {
    expect(tenantApi('t/1', 'events', 'e 2')).toBe('/tenants/t%2F1/events/e%202');
    expect(orgPath('t1', 'events')).toBe('/org/t1/events');
  });
});
