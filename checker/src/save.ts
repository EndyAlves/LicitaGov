// Entrega do arquivo gerado. Publicado como página do Claude, o navegador não
// pode baixar direto: o pedido passa pelo visualizador, que confirma com a
// pessoa. Fora dele (hospedagem própria), usa o download comum.
import './claude';

export type SaveResult = 'saved' | 'declined' | 'unavailable';

export async function saveFile(filename: string, blob: Blob): Promise<SaveResult> {
  const downloads = window.claude ? await window.claude.use('downloads').catch(() => null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'declined' || code === 'rate_limited' ? 'declined' : 'unavailable';
    }
  }
  if (window.claude) return 'unavailable';
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
