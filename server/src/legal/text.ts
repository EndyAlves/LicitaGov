/** Minúsculas e sem acentos: as regras casam padrões sobre esse texto. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Devolve o trecho original (com ~60 caracteres de contexto) em torno da posição de um match. */
export function excerptAt(original: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(original.length, index + length + 60);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < original.length ? '…' : '';
  return `${prefix}${original.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/** Divide o texto em parágrafos (linhas em branco ou títulos numerados). */
export function paragraphs(text: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  for (const m of text.matchAll(re)) {
    if (m[0].trim()) out.push({ text: m[0], index: m.index ?? 0 });
  }
  return out;
}

export function anyMatch(normalized: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m) return m;
  }
  return null;
}
