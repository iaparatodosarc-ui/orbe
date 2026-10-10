// Orbe 3.1 — lectura de carpetas y archivos que el usuario le muestra al orbe (solo en su PC).
// Nada sale del equipo salvo lo que se envía a Claude cuando el usuario pregunta.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_LIST = 200;          // entradas detalladas de una carpeta
const MAX_WALK = 5000;         // archivos contados en el resumen recursivo
const MAX_TEXT = 60000;        // caracteres de texto que se envían
const MAX_PDF = 15 * 1024 * 1024;
const MAX_IMG = 4.5 * 1024 * 1024;

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.java', '.kt', '.c', '.cpp', '.h', '.cs', '.php', '.rb', '.go', '.rs', '.sql', '.log', '.ini', '.cfg', '.yaml', '.yml', '.bat', '.ps1', '.sh', '.srt', '.vtt']);
const IMG_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function human(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
const day = d => d.toISOString().slice(0, 10);

function kindOf(ext) {
  ext = ext.toLowerCase();
  if (IMG_TYPES[ext] || ['.bmp', '.heic', '.svg', '.tif', '.tiff', '.raw'].includes(ext)) return 'imagen';
  if (['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'].includes(ext)) return 'audio';
  if (['.pdf', '.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'documento';
  if (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) return 'planilla';
  if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'presentación';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'comprimido';
  if (['.exe', '.msi', '.apk', '.lnk', '.url'].includes(ext)) return 'programa/acceso directo';
  if (TEXT_EXT.has(ext)) return 'texto/código';
  return ext ? ext.slice(1) : 'archivo';
}

/** Describe una carpeta: lista sus elementos y un resumen recursivo acotado. Devuelve texto para Claude. */
function describeFolder(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return `[Folder "${dir}" could not be read: ${e.code || e.message}]`; }
  const rows = [];
  for (const d of entries.slice(0, MAX_LIST)) {
    const p = path.join(dir, d.name);
    try {
      const st = fs.statSync(p);
      rows.push({ name: d.name, dir: st.isDirectory(), size: st.size, mtime: st.mtime });
    } catch { rows.push({ name: d.name, dir: d.isDirectory(), size: 0, mtime: null }); }
  }
  rows.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  // resumen recursivo (hasta MAX_WALK archivos o 1,5 s)
  const byKind = {}; let files = 0, folders = 0, total = 0, biggest = []; const t0 = Date.now(); let cut = false;
  const stack = [dir];
  while (stack.length) {
    if (files >= MAX_WALK || Date.now() - t0 > 1500) { cut = true; break; }
    const cur = stack.pop(); let list = [];
    try { list = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const d of list) {
      const p = path.join(cur, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) { folders++; stack.push(p); continue; }
      let size = 0; try { size = fs.statSync(p).size; } catch {}
      files++; total += size;
      const k = kindOf(path.extname(d.name)); byKind[k] = (byKind[k] || 0) + 1;
      biggest.push({ p: path.relative(dir, p), size }); if (biggest.length > 40) { biggest.sort((a, b) => b.size - a.size); biggest = biggest.slice(0, 10); }
    }
  }
  biggest.sort((a, b) => b.size - a.size); biggest = biggest.slice(0, 5);
  const lines = [`[Folder shown by the user: "${dir}"]`,
    `Direct contents: ${entries.length} items${entries.length > MAX_LIST ? ` (first ${MAX_LIST} listed)` : ''}.`];
  for (const r of rows) lines.push(r.dir ? `- [carpeta] ${r.name}/` : `- ${r.name} — ${kindOf(path.extname(r.name))}, ${human(r.size)}${r.mtime ? ', ' + day(r.mtime) : ''}`);
  lines.push(`Including subfolders${cut ? ' (partial count)' : ''}: ${files} files in ${folders} subfolders, ${human(total)} in total.`);
  const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', ');
  if (kinds) lines.push(`By type: ${kinds}.`);
  if (biggest.length) lines.push('Largest files: ' + biggest.map(b => `${b.p} (${human(b.size)})`).join('; ') + '.');
  return lines.join('\n');
}

// ---------- lector mínimo de .zip (para .docx/.xlsx/.pptx) ----------
function unzip(buf) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const n = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    off += 46 + nlen + xlen + clen;
    if (!/\.xml$/.test(name)) continue;
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    try { out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); } catch {}
  }
  return out;
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function officeText(file, ext) {
  const z = unzip(fs.readFileSync(file));
  if (ext === '.docx') {
    const x = z['word/document.xml'] || '';
    return unxml(x.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '')).trim();
  }
  if (ext === '.pptx') {
    return Object.keys(z).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
      .map((k, i) => `--- Diapositiva ${i + 1} ---\n` + unxml(z[k].replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')).trim()).join('\n');
  }
  if (ext === '.xlsx') {
    const shared = [...(z['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml(m[1].replace(/<[^>]+>/g, '')));
    const sheets = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort().slice(0, 5);
    return sheets.map((k, i) => {
      const rows = [...z[k].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 400).map(r =>
        [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(c => {
          const attrs = c[1], inner = c[2] || ''; const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          const t = (attrs.match(/t="(\w+)"/) || [])[1];
          if (t === 's' && v != null) return shared[+v] ?? '';
          if (t === 'inlineStr') return unxml(inner.replace(/<[^>]+>/g, ''));
          return v != null ? unxml(v) : '';
        }).join('\t'));
      return `--- Hoja ${i + 1} ---\n` + rows.join('\n');
    }).join('\n');
  }
  return '';
}

/**
 * Describe un archivo. Si readContent es true, agrega su contenido como bloques para Claude.
 * Devuelve { blocks:[...], note } listos para el mensaje.
 */
function describeFile(file, readContent) {
  let st; try { st = fs.statSync(file); } catch (e) { return { blocks: [{ type: 'text', text: `[File "${file}" could not be read: ${e.code || e.message}]` }] }; }
  const ext = path.extname(file).toLowerCase();
  const meta = `[File shown by the user: "${file}" — ${kindOf(ext)}, ${human(st.size)}, modified ${day(st.mtime)}]`;
  if (!readContent) return { blocks: [{ type: 'text', text: meta + '\n[Content not read: the user has "Read content" turned off.]' }] };
  try {
    if (ext === '.pdf') {
      if (st.size > MAX_PDF) return { blocks: [{ type: 'text', text: meta + '\n[PDF too large to read (max 15 MB).]' }] };
      return { blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(file).toString('base64') } }, { type: 'text', text: meta }] };
    }
    if (IMG_TYPES[ext]) {
      if (st.size > MAX_IMG) return { blocks: [{ type: 'text', text: meta + '\n[Image too large to read (max ~4.5 MB).]' }] };
      return { blocks: [{ type: 'image', source: { type: 'base64', media_type: IMG_TYPES[ext], data: fs.readFileSync(file).toString('base64') } }, { type: 'text', text: meta }] };
    }
    let txt = '';
    if (['.docx', '.xlsx', '.pptx'].includes(ext)) txt = officeText(file, ext);
    else if (TEXT_EXT.has(ext) && st.size < 20 * 1024 * 1024) txt = fs.readFileSync(file, 'utf8');
    else return { blocks: [{ type: 'text', text: meta + '\n[Orbe cannot read the inside of this file type; only its name and details are known.]' }] };
    const cutNote = txt.length > MAX_TEXT ? `\n[...content cut: showing the first ${MAX_TEXT} of ${txt.length} characters]` : '';
    return { blocks: [{ type: 'text', text: `${meta}\n<file_content>\n${txt.slice(0, MAX_TEXT)}${cutNote}\n</file_content>` }] };
  } catch (e) {
    return { blocks: [{ type: 'text', text: meta + `\n[Could not read the content: ${e.message}]` }] };
  }
}

module.exports = { describeFolder, describeFile, human };
