// A Word file (.docx) read for the screen, so an interview guideline can be read inside Student Recruit 360 (the owner, 27 Nov
// 2026: "if it is in a PDF, if it is in a Word, they can also see it"). A .docx is a zip of XML files; this reads the headings,
// paragraphs, lists, tables, pictures and web links and gives them back as plain data, which the page builds with text only, so
// nothing inside a file can ever run. It shows the words and their order, not an exact copy of Word's page layout (Download gives
// the file itself).
const zlib = require('zlib');

const MAX_PART = 24 * 1024 * 1024; // one file inside the zip, unpacked
const MAX_PICTURE = 4 * 1024 * 1024;
const MAX_PICTURES = 8 * 1024 * 1024; // all pictures of one document together
const MAX_BLOCKS = 4000;
const MAX_DEPTH = 40;

// ---- the zip ---------------------------------------------------------------------------------------------------------------------
function openZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let n = 0; n < count && at + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    files.set(name, { method, size, local });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return {
    read(name) {
      const f = files.get(name);
      if (!f || f.local + 30 > buf.length || buf.readUInt32LE(f.local) !== 0x04034b50) return null;
      const start = f.local + 30 + buf.readUInt16LE(f.local + 26) + buf.readUInt16LE(f.local + 28);
      const data = buf.subarray(start, start + f.size);
      if (f.method === 0) return data.length <= MAX_PART ? data : null;
      if (f.method !== 8) return null;
      return zlib.inflateRawSync(data, { maxOutputLength: MAX_PART }); // a file made to unpack without end is refused here
    },
  };
}

// ---- the XML: only what Word writes (elements, attributes, text) -------------------------------------------------------------------
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] !== '#') return ENTITY[e] || all;
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});
function parseXml(source) {
  const root = { name: '', attrs: {}, kids: [] };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attr = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = token.exec(source))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.kids.push(m[1]);
    else if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); } else if (m[3] !== undefined) {
      const node = { name: m[3], attrs: {}, kids: [] };
      if (m[4]) { attr.lastIndex = 0; let a; while ((a = attr.exec(m[4]))) node.attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]); }
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.kids.push(decode(m[6]));
  }
  return root;
}
const kids = (node, name) => (node ? node.kids.filter((k) => typeof k === 'object' && (!name || k.name === name)) : []);
const kid = (node, name) => kids(node, name)[0] || null;
const val = (node) => (node ? node.attrs['w:val'] : undefined);
const find = (node, name, depth = 0) => {
  if (!node || depth > MAX_DEPTH) return null;
  for (const k of kids(node)) { if (k.name === name) return k; const deeper = find(k, name, depth + 1); if (deeper) return deeper; }
  return null;
};
const findAll = (node, name, out = [], depth = 0) => {
  if (!node || depth > MAX_DEPTH) return out;
  for (const k of kids(node)) { if (k.name === name) out.push(k); else findAll(k, name, out, depth + 1); }
  return out;
};
// An element switched on, as Word writes it: <w:b/> or <w:b w:val="1"/>; "0", "false" and "none" mean off.
const on = (node) => Boolean(node) && !['0', 'false', 'none'].includes(String(val(node)));

// ---- the parts of the document -----------------------------------------------------------------------------------------------------
function readStyles(xml) {
  const out = new Map();
  kids(kid(xml, 'w:styles'), 'w:style').forEach((s) => {
    const pPr = kid(s, 'w:pPr');
    const num = kid(pPr, 'w:numPr');
    out.set(s.attrs['w:styleId'], {
      name: String(val(kid(s, 'w:name')) || ''), basedOn: val(kid(s, 'w:basedOn')),
      numId: val(kid(num, 'w:numId')), level: val(kid(num, 'w:ilvl')), outline: val(kid(pPr, 'w:outlineLvl')),
    });
  });
  return out;
}
// A style with what it takes from the style it is based on.
function styleOf(styles, id) {
  const out = { name: '', numId: undefined, level: undefined, outline: undefined };
  let s = styles.get(id);
  out.name = s ? s.name : '';
  for (let i = 0; s && i < 12; i += 1) {
    ['numId', 'level', 'outline'].forEach((k) => { if (out[k] === undefined) out[k] = s[k]; });
    s = styles.get(s.basedOn);
  }
  return out;
}
function readNumbering(xml) {
  const root = kid(xml, 'w:numbering');
  const abstract = new Map(kids(root, 'w:abstractNum').map((a) => [a.attrs['w:abstractNumId'], new Map(kids(a, 'w:lvl').map((l) => [Number(l.attrs['w:ilvl']), {
    format: val(kid(l, 'w:numFmt')) || 'decimal', start: Number(val(kid(l, 'w:start')) ?? 1), text: String(val(kid(l, 'w:lvlText')) ?? ''),
  }]))]));
  return new Map(kids(root, 'w:num').map((n) => [n.attrs['w:numId'], { id: val(kid(n, 'w:abstractNumId')), levels: abstract.get(val(kid(n, 'w:abstractNumId'))) || new Map() }]));
}
const roman = (n) => {
  let left = Math.max(1, Math.min(3999, n)); let out = '';
  [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].forEach(([v, s]) => { while (left >= v) { out += s; left -= v; } });
  return out;
};
const letters = (n) => String.fromCharCode(97 + ((Math.max(1, n) - 1) % 26)).repeat(Math.floor((Math.max(1, n) - 1) / 26) + 1);
const shownNumber = (format, n) => (format === 'lowerLetter' ? letters(n) : format === 'upperLetter' ? letters(n).toUpperCase()
  : format === 'lowerRoman' ? roman(n) : format === 'upperRoman' ? roman(n).toUpperCase() : format === 'decimalZero' ? String(n).padStart(2, '0') : String(n));

const PICTURES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

function docxPreview(buf) {
  const zip = openZip(buf);
  const part = (name) => { const data = zip.read(name); return data ? parseXml(data.toString('utf8')) : null; };
  const main = part('word/document.xml');
  const body = main && kid(kid(main, 'w:document'), 'w:body');
  if (!body) throw new Error('no document inside');
  const styles = readStyles(part('word/styles.xml'));
  const numbering = readNumbering(part('word/numbering.xml'));
  const links = new Map(kids(kid(part('word/_rels/document.xml.rels'), 'Relationships'), 'Relationship').map((r) => [r.attrs.Id, r.attrs]));
  const counters = new Map(); // the numbers of each numbered list, by level
  let pictureBytes = 0;
  let blocks = 0;
  let truncated = false;

  const picture = (id, alt) => {
    const rel = links.get(id);
    if (!rel || rel.TargetMode === 'External') return null;
    const target = String(rel.Target || '').replace(/\\/g, '/');
    const name = target.startsWith('/') ? target.slice(1) : `word/${target}`;
    const type = PICTURES[(name.split('.').pop() || '').toLowerCase()];
    const data = type ? zip.read(name) : null;
    if (!data || data.length > MAX_PICTURE || pictureBytes + data.length > MAX_PICTURES) return { s: '[Picture: download the file to see it]', i: true };
    pictureBytes += data.length;
    return { img: `data:${type};base64,${data.toString('base64')}`, alt: String(alt || 'Picture').slice(0, 200) };
  };

  // The words of one paragraph, in order, with bold, italic, underline and web links; text boxes inside it come after it.
  function runsOf(node, runs, boxes, link, depth) {
    if (depth > MAX_DEPTH) return;
    for (const k of kids(node)) {
      if (k.name === 'w:r') runOf(k, runs, boxes, link, depth + 1);
      else if (k.name === 'w:hyperlink') {
        const rel = links.get(k.attrs['r:id']);
        const href = rel && rel.TargetMode === 'External' && /^(https?:\/\/|mailto:)/i.test(rel.Target) ? rel.Target : link;
        runsOf(k, runs, boxes, href, depth + 1);
      } else if (k.name === 'mc:AlternateContent') runsOf(kid(k, 'mc:Fallback') || kid(k, 'mc:Choice'), runs, boxes, link, depth + 1);
      else if (!['w:del', 'w:moveFrom', 'w:pPr'].includes(k.name)) runsOf(k, runs, boxes, link, depth + 1); // tracked insertions, fields, content controls
    }
  }
  function runOf(r, runs, boxes, link, depth) {
    const rPr = kid(r, 'w:rPr');
    const look = { ...(on(kid(rPr, 'w:b')) ? { b: true } : {}), ...(on(kid(rPr, 'w:i')) ? { i: true } : {}), ...(on(kid(rPr, 'w:u')) ? { u: true } : {}), ...(link ? { href: link } : {}) };
    const say = (s) => {
      const last = runs[runs.length - 1];
      if (last && last.s !== undefined && last.b === look.b && last.i === look.i && last.u === look.u && last.href === look.href) last.s += s;
      else runs.push({ s, ...look });
    };
    const walk = (node, d) => {
      if (d > MAX_DEPTH) return;
      for (const k of kids(node)) {
        if (k.name === 'w:t') say(k.kids.filter((x) => typeof x === 'string').join(''));
        else if (k.name === 'w:tab') say('\t');
        else if (k.name === 'w:br' || k.name === 'w:cr') { if (k.attrs['w:type'] !== 'page') say('\n'); } else if (k.name === 'w:noBreakHyphen') say('-');
        else if (k.name === 'w:drawing' || k.name === 'w:pict' || k.name === 'w:object') {
          const inside = findAll(k, 'w:txbxContent');
          if (inside.length) { boxes.push(...inside); continue; }
          const blip = find(k, 'a:blip'); const old = find(k, 'v:imagedata'); const about = find(k, 'wp:docPr');
          const p = blip ? picture(blip.attrs['r:embed'], about && about.attrs.descr) : old ? picture(old.attrs['r:id'], old.attrs['o:title']) : null;
          if (p) runs.push(p);
        } else if (k.name === 'mc:AlternateContent') walk(kid(k, 'mc:Choice') || kid(k, 'mc:Fallback'), d + 1);
      }
    };
    walk(r, depth);
  }

  function paragraph(p, out, depth) {
    const pPr = kid(p, 'w:pPr');
    const style = styleOf(styles, val(kid(pPr, 'w:pStyle')));
    const runs = []; const boxes = [];
    runsOf(p, runs, boxes, '', depth);
    const words = runs.some((r) => r.img || String(r.s).trim());
    if (words) {
      const heading = /^heading\s*(\d)/i.exec(style.name);
      const outline = val(kid(pPr, 'w:outlineLvl')) ?? style.outline;
      const level = /^title$/i.test(style.name) ? 1 : heading ? Math.min(4, Number(heading[1]) + 1) : outline !== undefined && Number(outline) < 4 ? Number(outline) + 2 : 0;
      const num = kid(pPr, 'w:numPr');
      const numId = val(kid(num, 'w:numId')) ?? style.numId;
      const depthIn = Math.min(8, Number(val(kid(num, 'w:ilvl')) ?? style.level ?? 0));
      const list = numId && numId !== '0' ? numbering.get(numId) : null;
      const align = val(kid(pPr, 'w:jc'));
      const block = { t: level ? 'h' : list ? 'li' : 'p', runs };
      if (level) block.level = Math.min(4, level);
      if (align === 'center') block.align = 'center'; else if (align === 'right' || align === 'end') block.align = 'right';
      if (list) {
        const how = list.levels.get(depthIn) || { format: 'bullet', start: 1, text: '' };
        const key = list.id ?? numId;
        const c = counters.get(key) || [];
        c[depthIn] = c[depthIn] === undefined ? how.start : c[depthIn] + 1;
        c.length = depthIn + 1; // a deeper list starts again under the next item
        counters.set(key, c);
        const label = how.format === 'bullet' ? '•' : how.format === 'none' ? ''
          : (how.text || `%${depthIn + 1}.`).replace(/%(\d)/g, (all, i) => { const up = list.levels.get(Number(i) - 1); return shownNumber(up ? up.format : 'decimal', c[Number(i) - 1] ?? (up ? up.start : 1)); });
        if (level) { if (label && label !== '•') block.runs = [{ s: `${label} ` }, ...runs]; } else Object.assign(block, { depth: depthIn, label });
      }
      add(out, block);
    }
    boxes.forEach((b) => blocksOf(b, out, depth + 1));
  }
  function table(tbl, out, depth) {
    const rows = [];
    const rowNodes = (node) => kids(node).flatMap((k) => (k.name === 'w:tr' ? [k] : k.name === 'w:sdt' ? rowNodes(kid(k, 'w:sdtContent')) : []));
    const cellNodes = (node) => kids(node).flatMap((k) => (k.name === 'w:tc' ? [k] : k.name === 'w:sdt' ? cellNodes(kid(k, 'w:sdtContent')) : []));
    rowNodes(tbl).forEach((tr) => {
      const cells = cellNodes(tr).map((tc) => {
        const pr = kid(tc, 'w:tcPr');
        const merge = kid(pr, 'w:vMerge');
        const cell = { blocks: [] };
        const span = Number(val(kid(pr, 'w:gridSpan')) || 1);
        if (span > 1) cell.span = Math.min(30, span);
        if (!merge || val(merge) === 'restart') blocksOf(tc, cell.blocks, depth + 1);
        return cell;
      });
      if (cells.length) rows.push(cells);
    });
    if (rows.length) add(out, { t: 'table', rows });
  }
  function add(out, block) {
    if (blocks >= MAX_BLOCKS) { truncated = true; return; }
    blocks += 1;
    out.push(block);
  }
  function blocksOf(node, out, depth) {
    if (depth > MAX_DEPTH) return;
    for (const k of kids(node)) {
      if (truncated) return;
      if (k.name === 'w:p') paragraph(k, out, depth + 1);
      else if (k.name === 'w:tbl') table(k, out, depth + 1);
      else if (k.name === 'w:sdt') blocksOf(kid(k, 'w:sdtContent'), out, depth + 1);
      else if (['w:ins', 'w:customXml', 'w:smartTag'].includes(k.name)) blocksOf(k, out, depth + 1);
    }
  }

  const out = [];
  blocksOf(body, out, 0);
  return { blocks: out, truncated };
}

module.exports = { docxPreview };
