// Leitura e regravação de .docx preservando a formatação.
//
// Na leitura, cada parágrafo do Word vira um bloco do editor (blocos separados
// por linha em branco). Na gravação, o texto editado é comparado bloco a bloco
// com os parágrafos originais: parágrafos iguais ficam intactos no XML (com
// toda a formatação), alterados mantêm o estilo do parágrafo e do primeiro
// trecho de texto, e novos copiam a formatação de um parágrafo vizinho do
// mesmo tipo (título ou corpo).
import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface DocxSource {
  /** Bytes originais do arquivo. */
  bytes: ArrayBuffer;
  name: string;
}

const isW = (n: Node, local: string) => n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === local;

/** Parágrafos do corpo, na ordem do documento, sem as cópias de compatibilidade (mc:Fallback). */
function bodyParagraphs(doc: XMLDocument): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W, 'p')).filter((p) => {
    for (let a = p.parentElement; a; a = a.parentElement) if (a.localName === 'Fallback') return false;
    return true;
  });
}

/** Texto visível do parágrafo: ignora texto excluído em revisão, códigos de campo e parágrafos aninhados. */
function paragraphText(p: Element): string {
  let out = '';
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      if (el.namespaceURI === W) {
        if (el.localName === 'p' || el.localName === 'del' || el.localName === 'instrText' || el.localName === 'delText') continue;
        if (el.localName === 't') {
          out += el.textContent ?? '';
          continue;
        }
        if (el.localName === 'tab') {
          out += '\t';
          continue;
        }
        if (el.localName === 'br' || el.localName === 'cr') {
          out += '\n';
          continue;
        }
      }
      walk(el);
    }
  };
  walk(p);
  return out;
}

async function loadDocument(bytes: ArrayBuffer) {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Arquivo .docx sem word/document.xml');
  const doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML do documento inválido');
  return { zip, doc };
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Texto do .docx para o editor: um bloco por parágrafo não vazio. */
export async function readDocx(bytes: ArrayBuffer): Promise<string> {
  const { doc } = await loadDocument(bytes);
  return bodyParagraphs(doc)
    .map((p) => paragraphText(p).replace(/[ \t]+$/gm, ''))
    .filter((t) => t.trim())
    .join('\n\n');
}

/** Blocos do texto editado (separados por linha em branco). */
export function blocksOf(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((b) => b.replace(/^\n+|\n+$/g, ''))
    .filter((b) => b.trim());
}

type Op = { op: 'eq'; a: number; b: number } | { op: 'del'; a: number } | { op: 'ins'; b: number };

/** Diferença por maior subsequência comum entre duas listas de parágrafos. */
export function diff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ op: 'eq', a: i++, b: j++ });
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: 'del', a: i++ });
    else ops.push({ op: 'ins', b: j++ });
  }
  while (i < n) ops.push({ op: 'del', a: i++ });
  while (j < m) ops.push({ op: 'ins', b: j++ });
  return ops;
}

/** Título: linha curta em caixa alta ou numerada sem ponto final. */
export function looksLikeHeading(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 90 || t.includes('\n')) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  return /^\d+(\.\d+)*[.)]?\s+[A-Za-zÀ-ÿ]/.test(t) && !/[.;:]$/.test(t) && t.length <= 70;
}

interface Token {
  el: Element;
  kind: 't' | 'tab' | 'br';
  start: number;
  end: number;
}

/** Elementos que formam o texto visível do parágrafo, com as posições de cada um (mesma regra de paragraphText). */
function tokensOf(p: Element): Token[] {
  const out: Token[] = [];
  let pos = 0;
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      if (el.namespaceURI === W) {
        if (el.localName === 'p' || el.localName === 'del' || el.localName === 'instrText' || el.localName === 'delText') continue;
        const kind = el.localName === 't' ? 't' : el.localName === 'tab' ? 'tab' : el.localName === 'br' || el.localName === 'cr' ? 'br' : null;
        if (kind) {
          const len = kind === 't' ? (el.textContent ?? '').length : 1;
          out.push({ el, kind, start: pos, end: pos + len });
          pos += len;
          continue;
        }
      }
      walk(el);
    }
  };
  walk(p);
  return out;
}

/**
 * Reescreve o parágrafo mexendo só no trecho que mudou: o começo e o fim iguais
 * ao original mantêm seus trechos de texto (negrito, cor, fonte); o texto novo
 * entra no trecho onde começa a mudança e herda a formatação dele.
 */
function rewriteParagraph(doc: XMLDocument, p: Element, text: string) {
  const tokens = tokensOf(p);
  const old = paragraphText(p);
  if (old === text) return;
  let pre = 0;
  while (pre < old.length && pre < text.length && old[pre] === text[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < text.length - pre && old[old.length - 1 - suf] === text[text.length - 1 - suf]) suf++;
  const delA = pre;
  const delB = old.length - suf;
  const ins = text.slice(pre, text.length - suf);
  const target =
    tokens.find((t) => t.kind === 't' && t.start < delA && delA <= t.end) ?? tokens.find((t) => t.kind === 't' && t.start === delA && t.end > t.start);
  if (!tokens.length || /[\n\t]/.test(ins) || (ins && !target)) {
    setParagraphText(doc, p, text);
    return;
  }
  for (const t of tokens) {
    if (t.end <= delA || t.start >= delB) continue;
    if (t.kind !== 't') {
      t.el.parentNode?.removeChild(t.el);
      continue;
    }
    const s = t.el.textContent ?? '';
    t.el.textContent = s.slice(0, Math.max(0, delA - t.start)) + s.slice(Math.min(s.length, delB - t.start));
  }
  if (ins && target) {
    const cur = target.el.textContent ?? '';
    const off = delA - target.start;
    target.el.textContent = cur.slice(0, off) + ins + cur.slice(off);
  }
  for (const t of tokens) if (t.kind === 't') t.el.setAttributeNS(XML_NS, 'xml:space', 'preserve');
}

function setParagraphText(doc: XMLDocument, p: Element, text: string) {
  const firstRun = Array.from(p.getElementsByTagNameNS(W, 'r')).find((r) => r.getElementsByTagNameNS(W, 't').length);
  const rPr = firstRun ? Array.from(firstRun.childNodes).find((c) => isW(c, 'rPr')) : undefined;
  for (const c of Array.from(p.childNodes)) if (!isW(c, 'pPr')) p.removeChild(c);
  const run = () => {
    const r = doc.createElementNS(W, 'w:r');
    if (rPr) r.appendChild(rPr.cloneNode(true));
    p.appendChild(r);
    return r;
  };
  text.split('\n').forEach((line, li) => {
    const r = run();
    if (li > 0) r.appendChild(doc.createElementNS(W, 'w:br'));
    line.split('\t').forEach((part, ti) => {
      if (ti > 0) r.appendChild(doc.createElementNS(W, 'w:tab'));
      if (!part) return;
      const t = doc.createElementNS(W, 'w:t');
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      t.textContent = part;
      r.appendChild(t);
    });
  });
}

/** Parágrafo novo com a formatação de `template`, sem quebra de seção, marcadores ou comentários. */
function cloneParagraph(doc: XMLDocument, template: Element, text: string): Element {
  const p = template.cloneNode(true) as Element;
  const pPr = Array.from(p.childNodes).find((c) => isW(c, 'pPr')) as Element | undefined;
  if (pPr) for (const c of Array.from(pPr.childNodes)) if (isW(c, 'sectPr')) pPr.removeChild(c);
  for (const a of Array.from(p.attributes)) if (a.localName.startsWith('rsid') || a.localName === 'paraId' || a.localName === 'textId') p.removeAttributeNode(a);
  setParagraphText(doc, p, text);
  return p;
}

/**
 * Gera o .docx corrigido a partir do original: só os parágrafos que mudaram
 * são reescritos; o resto do arquivo (estilos, cabeçalho, rodapé, tabelas,
 * imagens) fica igual.
 */
export async function writeDocx(source: DocxSource, editedText: string): Promise<Blob> {
  const { zip, doc } = await loadDocument(source.bytes);
  const paras = bodyParagraphs(doc).filter((p) => paragraphText(p).trim());
  const orig = paras.map((p) => clean(paragraphText(p)));
  const blocks = blocksOf(editedText);
  const ops = diff(orig, blocks.map(clean));
  const inTable = paras.map((p) => {
    for (let a = p.parentElement; a; a = a.parentElement) if (a.namespaceURI === W && a.localName === 'tbl') return true;
    return false;
  });
  // Título pelo estilo do Word (Título 1, Heading 2…) ou, sem estilo, pela aparência do texto.
  const styled = paras.map((p) => {
    const pPr = Array.from(p.childNodes).find((c) => isW(c, 'pPr')) as Element | undefined;
    const style = pPr && (Array.from(pPr.childNodes).find((c) => isW(c, 'pStyle')) as Element | undefined)?.getAttributeNS(W, 'val');
    const outline = pPr && Array.from(pPr.childNodes).some((c) => isW(c, 'outlineLvl'));
    return outline || /heading|ttulo|titulo|title/i.test(style ?? '');
  });
  const headingFlags = orig.map((t, k) => styled[k] || looksLikeHeading(t));

  /** Parágrafo vizinho fora de tabelas para copiar a formatação; títulos preferem um título com estilo de seção. */
  const template = (near: number, heading: boolean): Element | undefined => {
    const pick = (ok: (k: number) => boolean) => {
      for (let d = 0; d < paras.length; d++) for (const k of [near - d, near + d + 1]) if (k >= 0 && k < paras.length && !inTable[k] && ok(k)) return paras[k];
      return undefined;
    };
    const isTitle = (k: number) => /title/i.test((paras[k].getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val')) ?? '');
    return (
      (heading ? pick((k) => styled[k] && !isTitle(k)) : undefined) ??
      pick((k) => headingFlags[k] === heading) ??
      paras[Math.min(Math.max(near, 0), paras.length - 1)]
    );
  };

  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const cellOf = (p: Element) => {
    for (let a = p.parentElement; a && a !== body; a = a.parentElement) if (a.namespaceURI === W && a.localName === 'tc') return a;
    return null;
  };
  /** Elemento de nível do corpo que contém o parágrafo (a tabela inteira, no caso de célula). */
  const topLevel = (p: Element) => {
    let a: Element = p;
    while (a.parentElement && a.parentElement !== body) a = a.parentElement;
    return a;
  };

  let anchor: Element | null = null; // último parágrafo mantido ou reescrito
  let lastIndex = -1;
  /**
   * Onde entra um parágrafo novo, entre `anchor` e `next`: nunca dentro de uma
   * tabela vizinha; se as duas pontas estão na mesma célula, entra nela.
   */
  const placeNew = (p: Element, next: Element | null) => {
    const aCell = anchor ? cellOf(anchor) : null;
    const nCell = next ? cellOf(next) : null;
    if (anchor && (!aCell || aCell === nCell)) anchor.parentNode!.insertBefore(p, anchor.nextSibling);
    else if (next && !nCell) next.parentNode!.insertBefore(p, next);
    else if (anchor) body.insertBefore(p, topLevel(anchor).nextSibling);
    else if (next) body.insertBefore(p, topLevel(next));
    else body.insertBefore(p, Array.from(body.childNodes).find((c) => isW(c, 'sectPr')) ?? null);
    anchor = p;
  };

  for (let k = 0; k < ops.length; ) {
    const op = ops[k];
    if (op.op === 'eq') {
      anchor = paras[op.a];
      lastIndex = op.a;
      k++;
      continue;
    }
    // Agrupa exclusões e inclusões consecutivas: os pares viram parágrafos reescritos.
    const dels: number[] = [];
    const ins: number[] = [];
    while (k < ops.length && ops[k].op !== 'eq') {
      const o = ops[k++];
      if (o.op === 'del') dels.push(o.a);
      else if (o.op === 'ins') ins.push(o.b);
    }
    const paired = Math.min(dels.length, ins.length);
    const nextOp = ops[k];
    const next = nextOp && nextOp.op === 'eq' ? paras[nextOp.a] : null;
    for (let x = 0; x < paired; x++) {
      const p = paras[dels[x]];
      rewriteParagraph(doc, p, blocks[ins[x]]);
      anchor = p;
      lastIndex = dels[x];
    }
    for (const a of dels.slice(paired)) paras[a].parentNode?.removeChild(paras[a]);
    for (const b of ins.slice(paired)) {
      const tpl = template(lastIndex, looksLikeHeading(blocks[b]));
      if (tpl) placeNew(cloneParagraph(doc, tpl, blocks[b]), next);
    }
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** .docx novo para texto colado: títulos em negrito, corpo em Arial 12, espaçamento simples. */
export async function newDocx(text: string): Promise<Blob> {
  const para = (block: string) => {
    const bold = looksLikeHeading(block) ? '<w:b/>' : '';
    const runs = block
      .split('\n')
      .map((line, i) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold}<w:sz w:val="24"/></w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
      .join('');
    return `<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/><w:jc w:val="${bold ? 'left' : 'both'}"/></w:pPr>${runs}</w:p>`;
  };
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${blocksOf(text).map(para).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME });
}
