// A QR code drawn on the page, with nothing to download or install (the owner, 17 Nov 2026: the WhatsApp button of a student opens
// the student's chat on the phone). Scanning the code with the phone's camera opens the link it holds, for example the student's
// WhatsApp chat (https://wa.me/977...), in the phone's own WhatsApp: no WhatsApp Web, no login on the computer.
//
// QR Code Model 2, byte mode, error correction level M, versions 1 to 40 chosen by length; the eight masks are tried and the one
// with the lowest penalty kept (ISO/IEC 18004). Works in the browser (window.IsrQr) and in Node (for the tests).
//
//   IsrQr.matrix(text)          the dark (true) and light (false) modules, row by row
//   IsrQr.svg(text, { size })   an <svg> string with a quiet zone, black on white
(function (root) {
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_M = 0; // the two format bits of error correction level M

  const rawModules = (ver) => {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  };
  const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

  // Reed-Solomon over GF(256) with the polynomial 0x11D.
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z & 0xff;
  }
  function divisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1;
    let rootV = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], rootV); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      rootV = mul(rootV, 0x02);
    }
    return r;
  }
  function remainder(data, div) {
    const r = new Array(div.length).fill(0);
    data.forEach((b) => { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); });
    return r;
  }

  function alignments(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function encodeBytes(text) {
    const bytes = [];
    const s = unescape(encodeURIComponent(String(text))); // UTF-8
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    return bytes;
  }

  function matrix(text) {
    const bytes = encodeBytes(text);
    let ver = 1;
    for (; ver <= 40; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    if (ver > 40) throw new Error('Too long for a QR code.');
    // The bits: byte mode, the length, the bytes, then the end and the padding.
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // Split into blocks, add the error correction, interleave.
    const nBlocks = BLOCKS[ver]; const eccLen = ECC_PER_BLOCK[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks); const shortLen = Math.floor(raw / nBlocks);
    const div = divisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]); });

    // The grid: the fixed patterns first, then the data, then the best mask.
    const size = ver * 4 + 17;
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mods[y][x] = dark; fixed[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([x, y]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)); const xx = x + dx; const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    });
    const al = alignments(ver);
    al.forEach((ay, i) => al.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = (mask) => {
      const d = (FORMAT_M << 3) | mask;
      let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412;
      const bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0); // reserves the format areas
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1; const a = size - 11 + (i % 3); const c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
    }
    let n = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j; const up = ((right + 1) & 2) === 0; const y = up ? size - 1 - v : v;
        if (!fixed[y][x] && n < words.length * 8) { mods[y][x] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
      }
    }
    const masked = (m) => {
      const fn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
        (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][m];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && fn(x, y)) mods[y][x] = !mods[y][x];
    };
    let best = 0; let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      masked(m); format(m);
      const s = penalty(mods);
      if (s < bestScore) { bestScore = s; best = m; }
      masked(m); // undo (a mask is its own inverse)
    }
    masked(best); format(best);
    return mods;
  }

  // The standard penalty: long runs, 2x2 blocks, finder-like patterns, and dark and light out of balance.
  function penalty(m) {
    const size = m.length; let score = 0; let dark = 0;
    const line = (get) => {
      let s = 0;
      for (let i = 0; i < size; i++) {
        let run = 1;
        for (let j = 1; j <= size; j++) {
          if (j < size && get(i, j) === get(i, j - 1)) run++;
          else { if (run >= 5) s += run - 2; run = 1; }
        }
        for (let j = 0; j + 10 < size + 1; j++) {
          const p = [true, false, true, true, true, false, true];
          const at = (k) => (k >= 0 && k < size ? get(i, k) : false);
          if (p.every((v, k) => at(j + k) === v) && ([7, 8, 9, 10].every((k) => !at(j + k)) || [-1, -2, -3, -4].every((k) => !at(j + k)))) s += 40;
        }
      }
      return s;
    };
    score += line((i, j) => m[i][j]) + line((i, j) => m[j][i]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (y + 1 < size && x + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  }

  function svg(text, { size = 200, quiet = 4 } = {}) {
    const m = matrix(text);
    const n = m.length + quiet * 2;
    let path = '';
    m.forEach((row, y) => row.forEach((d, x) => { if (d) path += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  const api = { matrix, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IsrQr = api;
})(typeof window !== 'undefined' ? window : globalThis);
