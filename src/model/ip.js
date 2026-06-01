// Pure IPv4 helpers for the assign-IP step (Task 4.2). Kept dependency-free and
// side-effect-free so they're unit-testable under `node --test`.

// Basic IPv4 check: four dot-separated octets, each an integer 0..255, no blanks,
// no leading-zero ambiguity beyond "0" itself, no extra whitespace. Intentionally
// strict-but-simple — we only need to block blank/garbage controller IPs.
export function isValidIPv4(s) {
  if (typeof s !== 'string') return false;
  const parts = s.trim().split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
    if (p.length > 1 && p[0] === '0') return false; // reject "01", "007"
  }
  return true;
}

// Given a base IPv4 and a count, return `count` sequential IPs incrementing the
// final octet: nextIPs('10.0.0.11', 3) → ['10.0.0.11','10.0.0.12','10.0.0.13'].
// Returns null if the base is invalid or the range would overflow past .255.
export function nextIPs(base, count) {
  if (!isValidIPv4(base) || !Number.isInteger(count) || count < 0) return null;
  const parts = base.trim().split('.').map(Number);
  const last = parts[3];
  if (last + count - 1 > 255) return null; // would overflow the final octet
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`${parts[0]}.${parts[1]}.${parts[2]}.${last + i}`);
  }
  return out;
}
