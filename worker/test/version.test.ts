import { describe, expect, it } from 'vitest';
import { filterInt, parseVersion, versionCompare } from '../src/version';

describe('parseVersion', () => {
  it.each([
    ['6.0.0', '6.0.0', 6],
    ['v5.10.2', '5.10.2', 5],
    ['6.0.0-beta.1', '6.0.0-beta.1', 6],
    ['6.0.0+build.5', '6.0.0', 6],
  ])('%s を受け付ける', (input, _full, major) => {
    expect(parseVersion(input)?.major).toBe(major);
  });

  it.each(['', 'latest', '6.0', '01.0.0', '6.0.0-', '6.0.0.0', '../etc', 'vv1.0.0'])('%s は不正', (input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('filterInt (FILTER_VALIDATE_INT)', () => {
  it.each([
    ['5', 5],
    [' 5 ', 5],
    ['+5', 5],
    ['-3', -3],
    ['0', 0],
  ])('%s → %s', (input, expected) => expect(filterInt(input)).toBe(expected));

  it.each(['', 'abc', '1.5', '05', '1e3', '99999999999999999999', null])('%s は null', (input) => {
    expect(filterInt(input)).toBeNull();
  });
});

describe('versionCompare (PHP の version_compare)', () => {
  it.each([
    ['5.10.0', '5.9.1', 1],
    ['5.2.0', '5.2.0', 0],
    ['6.0.0', '6.0.0-beta.1', 1],
    ['6.0.0-rc.1', '6.0.0-beta.1', 1],
    ['6.0.0-beta.2', '6.0.0-beta.1', 1],
    ['6.0.0-alpha.1', '6.0.0-beta.1', -1],
    ['6.0.0-beta', '6.0.0-beta.1', -1],
    ['6.0.0-dev', '6.0.0-alpha', -1],
    ['6.0.0-foo', '6.0.0-dev', -1],
  ])('%s vs %s = %s', (a, b, expected) => expect(versionCompare(a, b)).toBe(expected));
});
