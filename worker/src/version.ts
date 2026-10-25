// app/Services/ValueObjects/Version.php と同じ SemVer 判定
const SEMVER_REGEX =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

export function parseVersion(input: string): Version | null {
  const m = SEMVER_REGEX.exec(input.replace(/^v/, ''));
  if (!m || !m.groups) return null;
  return {
    major: Number(m.groups.major),
    minor: Number(m.groups.minor),
    patch: Number(m.groups.patch),
    prerelease: m.groups.prerelease ?? '',
  };
}

export function fullVersion(v: Version): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease === '' ? base : `${base}-${v.prerelease}`;
}

// PHP の filter_var($x, FILTER_VALIDATE_INT) 相当。整数でなければ null
export function filterInt(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, '');
  if (!/^[+-]?(0|[1-9]\d*)$/.test(trimmed)) return null;
  const big = BigInt(trimmed);
  if (big > 9223372036854775807n || big < -9223372036854775808n) return null;
  return Number(big);
}

// ---- PHP の version_compare() の移植 ----

const isDigit = (c: string) => c >= '0' && c <= '9';
const isAlnum = (c: string) => isDigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

function canonicalize(version: string): string {
  if (version === '') return '';
  let out = version[0];
  let lp = version[0];
  for (let i = 1; i < version.length; i++) {
    const c = version[i];
    const lq = out[out.length - 1];
    const special = c === '-' || c === '_' || c === '+';
    const isNdig = (x: string) => !isDigit(x) && x !== '.';
    if (special) {
      if (lq !== '.') out += '.';
    } else if ((isNdig(lp) && isDigit(c)) || (isDigit(lp) && isNdig(c))) {
      if (lq !== '.') out += '.';
      out += c;
    } else if (!isAlnum(c)) {
      if (lq !== '.') out += '.';
    } else {
      out += c;
    }
    lp = c;
  }
  return out;
}

const SPECIAL_FORMS: Array<[string, number]> = [
  ['dev', 0],
  ['alpha', 1],
  ['a', 1],
  ['beta', 2],
  ['b', 2],
  ['RC', 3],
  ['rc', 3],
  ['#', 4],
  ['pl', 5],
  ['p', 5],
];

function specialOrder(form: string): number {
  for (const [name, order] of SPECIAL_FORMS) {
    if (form.startsWith(name)) return order;
  }
  return -6;
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

export function versionCompare(a: string, b: string): number {
  if (a === '' && b === '') return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  const p1 = canonicalize(a).split('.').filter((s) => s !== '');
  const p2 = canonicalize(b).split('.').filter((s) => s !== '');
  let i = 0;
  let compare = 0;
  for (; i < p1.length && i < p2.length; i++) {
    const x = p1[i];
    const y = p2[i];
    const dx = isDigit(x[0]);
    const dy = isDigit(y[0]);
    if (dx && dy) {
      compare = sign(parseInt(x, 10) - parseInt(y, 10));
    } else if (!dx && !dy) {
      compare = sign(specialOrder(x) - specialOrder(y));
    } else if (dx) {
      compare = sign(specialOrder('#N#') - specialOrder(y));
    } else {
      compare = sign(specialOrder(x) - specialOrder('#N#'));
    }
    if (compare !== 0) return compare;
  }
  if (i < p1.length) {
    return isDigit(p1[i][0]) ? 1 : versionCompare(p1.slice(i).join('.'), '#N#');
  }
  if (i < p2.length) {
    return isDigit(p2[i][0]) ? -1 : versionCompare('#N#', p2.slice(i).join('.'));
  }
  return 0;
}

// PHP 8 の文字列同士の <=>。両方が数値文字列なら数値として比較する
export function spaceship(a: string, b: string): number {
  const num = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
  if (num.test(a) && num.test(b)) return sign(Number(a) - Number(b));
  return a < b ? -1 : a > b ? 1 : 0;
}
