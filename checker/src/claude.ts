// Tipos mínimos das capacidades da página publicada no Claude (window.claude).
// Fora do Claude (hospedagem própria) window.claude não existe e os recursos
// que dependem dele ficam ocultos.

export interface DownloadsApi {
  save(req: { filename: string; data: Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}

export interface SampleOptions {
  modelTier?: 'default' | 'complex' | 'quick';
  signal?: AbortSignal;
  onText?: (u: { text: string; delta: string }) => void;
  cache?: boolean | { gcTime?: number; refresh?: boolean };
}

export interface SampleFn {
  (input: string, options?: SampleOptions): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
}

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

declare global {
  interface Window {
    claude?: {
      use(name: 'downloads'): Promise<DownloadsApi | null>;
      use(name: 'sample'): Promise<SampleFn | null>;
    };
  }
}

/** Texto para quem usa, por código de erro do Claude. */
export function sampleErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'not_granted':
      return 'O uso do Claude não foi autorizado nesta página. A verificação automática continua disponível.';
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'A análise com IA não está disponível nesta conta ou visualização.';
    case 'rate_limited':
      return 'O limite de uso do Claude foi atingido no momento. Tente de novo em alguns minutos.';
    case 'prompt_too_large':
      return 'O documento é grande demais para uma análise só. Divida-o em partes e analise cada uma.';
    case 'session_expired':
      return 'Sua sessão no Claude expirou. Entre de novo e tente outra vez.';
    case 'invalid_json':
    case 'empty_completion':
      return 'A resposta da análise veio incompleta. Tente de novo.';
    case 'refused':
      return 'O Claude não concluiu esta análise. Revise o texto e tente de novo.';
    default:
      return 'Não foi possível concluir a análise agora. Tente de novo.';
  }
}

/** Erros que tornam a IA indisponível nesta visualização. */
export const PERMANENT_SAMPLE_ERRORS = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
