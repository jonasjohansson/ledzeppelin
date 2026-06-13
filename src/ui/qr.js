// Minimal, dependency-free QR Code generator (byte mode, ECC level M, versions
// 1–10 — plenty for a short LAN URL). Self-contained so the app stays offline.
// Implements the spec: Reed–Solomon over GF(256), block interleaving, the
// function patterns, all 8 data masks with penalty scoring, and format/version
// info. Output: a boolean module matrix, plus qrSvg() for rendering.

// --- GF(256), primitive polynomial 0x11d ---
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

// Reed–Solomon generator polynomial of degree `deg`.
function rsGen(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();   // leading term (x^deg, coeff 1) first
}
// EC codewords for one data block (polynomial division remainder). Exported for
// tests. gen has length deg+1 with gen[0]=1 (leading term, skipped in the loop).
export function rsEncode(data, deg) {
  const gen = rsGen(deg);
  const msg = data.concat(new Array(deg).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) for (let j = 1; j <= deg; j++) msg[i + j] ^= gfMul(gen[j], coef);
  }
  return msg.slice(data.length);
}

// --- Per-version ECC structure, level M: [ecPerBlock, [ [count, dataCodewords], … ] ] ---
const ECC_M = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};
const dataCodewords = (v) => ECC_M[v][1].reduce((s, [c, d]) => s + c * d, 0);
// Alignment-pattern centre coordinates per version (none for v1).
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Smallest version (1–10, level M) that fits `n` UTF-8 bytes in byte mode.
function pickVersion(n) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v >= 10 ? 16 : 8;          // byte-mode char-count bits
    const cap = dataCodewords(v) * 8 - 4 - countBits;
    if (n * 8 <= cap) return v;
  }
  throw new Error('QR: data too long');
}

// Build the data+ECC codeword stream (with block interleaving).
function makeCodewords(bytes, v) {
  const total = dataCodewords(v), countBits = v >= 10 ? 16 : 8;
  // Bit buffer: mode (0100) + count + data, then terminator + pad.
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  const cap = total * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < total; i++) data.push(PAD[i % 2]);

  // Split into blocks, compute ECC per block.
  const [ecPer, groups] = ECC_M[v];
  const dataBlocks = [], ecBlocks = [];
  let pos = 0;
  for (const [count, dlen] of groups) {
    for (let i = 0; i < count; i++) {
      const blk = data.slice(pos, pos + dlen); pos += dlen;
      dataBlocks.push(blk); ecBlocks.push(rsEncode(blk, ecPer));
    }
  }
  // Interleave data codewords, then EC codewords.
  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecPer; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

// --- Matrix construction ---
function buildMatrix(codewords, v) {
  const n = 17 + v * 4;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));   // null = free
  const fn = Array.from({ length: n }, () => new Array(n).fill(false)); // function module?

  const setFn = (r, c, val) => { if (r >= 0 && r < n && c >= 0 && c < n) { m[r][c] = val; fn[r][c] = true; } };
  // Finder + separators at the three corners.
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inb = (x) => x >= 0 && x <= 6;
      const on = inb(r) && inb(c) && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setFn(r0 + r, c0 + c, !!on);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  // Alignment patterns (skip ones overlapping finders).
  const ac = ALIGN[v];
  for (const r of ac) for (const c of ac) {
    if ((r <= 7 && c <= 7) || (r <= 7 && c >= n - 8) || (r >= n - 8 && c <= 7)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;   // ring + centre
      setFn(r + dr, c + dc, on);
    }
  }
  // Dark module + reserve format/version areas (filled later).
  setFn(n - 8, 8, true);
  const reserve = (r, c) => { if (!fn[r][c]) { m[r][c] = false; fn[r][c] = true; } };
  const reserveFormat = () => {
    for (let i = 0; i <= 8; i++) { reserve(8, i); reserve(i, 8); }   // copy 1 (top-left)
    for (let i = 0; i < 8; i++) { reserve(n - 1 - i, 8); reserve(8, n - 1 - i); }   // copy 2 + dark module
  };
  reserveFormat();
  if (v >= 7) {
    for (let i = 0; i < 18; i++) { const r = Math.floor(i / 3), c = i % 3; fn[r][n - 11 + c] = true; m[r][n - 11 + c] = false; fn[n - 11 + c][r] = true; m[n - 11 + c][r] = false; }
  }

  // Place data bits, zig-zag from bottom-right, upward/downward columns.
  let bit = 0;
  const bitAt = (i) => (codewords[i >> 3] >> (7 - (i & 7))) & 1;
  const totalBits = codewords.length * 8;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;   // skip the vertical timing column
    for (let i = 0; i < n; i++) {
      const up = ((col + 1) & 2) === 0;        // direction flips each column pair
      const row = up ? n - 1 - i : i;
      for (let c2 = 0; c2 < 2; c2++) {
        const cc = col - c2;
        if (fn[row][cc]) continue;
        m[row][cc] = bit < totalBits ? !!bitAt(bit) : false;
        bit++;
      }
    }
  }
  return { m, fn, n };
}

// Mask predicates (0–7).
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

// Format info (level M = 0b00) + mask, BCH(15,5) + XOR mask.
function formatBits(mask) {
  let data = (0b00 << 3) | mask;          // level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) & 1 ? 0x1f25 : 0);
  return (v << 12) | rem;
}

function applyFormat(m, n, mask) {
  const f = formatBits(mask);
  const b = (i) => !!((f >> i) & 1);   // bit i (LSB)
  // Copy 1 around the top-left finder — MSB (bit 14) first along the path.
  for (let i = 0; i <= 5; i++) m[8][i] = b(14 - i);
  m[8][7] = b(8); m[8][8] = b(7); m[7][8] = b(6);
  for (let i = 9; i < 15; i++) m[14 - i][8] = b(14 - i);
  // Copy 2: column 8 (bottom→up) carries bits 14..8; row 8 (right→left) bits 0..7.
  for (let i = 0; i < 7; i++) m[n - 1 - i][8] = b(14 - i);
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = b(i);
  m[n - 8][8] = true;   // dark module (always set)
}
function applyVersion(m, n, v) {
  if (v < 7) return;
  const vb = versionBits(v);
  for (let i = 0; i < 18; i++) {
    const bit = !!((vb >> i) & 1), r = Math.floor(i / 3), c = i % 3;
    m[r][n - 11 + c] = bit; m[n - 11 + c][r] = bit;
  }
}

function penalty(m, n) {
  let score = 0;
  // Rule 1: runs of ≥5 same colour (rows + cols).
  for (let r = 0; r < n; r++) for (let pass = 0; pass < 2; pass++) {
    let run = 1, prev = pass ? m[0][r] : m[r][0];
    for (let i = 1; i < n; i++) {
      const cur = pass ? m[i][r] : m[r][i];
      if (cur === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else { run = 1; prev = cur; }
    }
  }
  // Rule 2: 2×2 blocks.
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const a = m[r][c]; if (a === m[r][c + 1] && a === m[r + 1][c] && a === m[r + 1][c + 1]) score += 3;
  }
  // Rule 3: finder-like 1:1:3:1:1 patterns.
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < n; r++) for (let c = 0; c <= n - 11; c++) {
    let ok1 = true, ok2 = true;
    for (let k = 0; k < 11; k++) { if (m[r][c + k] !== pat1[k]) ok1 = false; if (m[r][c + k] !== pat2[k]) ok2 = false; }
    if (ok1 || ok2) score += 40;
    let v1 = true, v2 = true;
    for (let k = 0; k < 11; k++) { if (m[c + k][r] !== pat1[k]) v1 = false; if (m[c + k][r] !== pat2[k]) v2 = false; }
    if (v1 || v2) score += 40;
  }
  // Rule 4: dark-module proportion.
  let dark = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
  const pct = (dark * 100) / (n * n);
  score += Math.min(Math.abs(Math.floor(pct / 5) * 5 - 50), Math.abs(Math.ceil(pct / 5) * 5 - 50)) / 5 * 10;
  return score;
}

// Encode `text` → boolean module matrix (true = dark).
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const v = pickVersion(bytes.length);
  const cw = makeCodewords(bytes, v);
  const { m, fn, n } = buildMatrix(cw, v);
  // Try all masks, keep the lowest penalty.
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const cand = m.map((row) => row.slice());
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r][c] && MASKS[mask](r, c)) cand[r][c] = !cand[r][c];
    applyFormat(cand, n, mask); applyVersion(cand, n, v);
    const s = penalty(cand, n);
    if (s < bestScore) { bestScore = s; best = cand; }
  }
  return best;
}

// Render a QR for `text` as an SVG string sized to `px` (with a quiet zone).
export function qrSvg(text, px = 120) {
  let m; try { m = qrMatrix(text); } catch { return ''; }
  const n = m.length, quiet = 4, total = n + quiet * 2;
  const cell = px / total;
  let rects = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) {
    rects += `<rect x="${((c + quiet) * cell).toFixed(2)}" y="${((r + quiet) * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges">`
    + `<rect width="${px}" height="${px}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
