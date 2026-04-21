export const TELEGRAM_HTML = 'HTML' as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function bold(value: string): string {
  return `<b>${escapeHtml(value)}</b>`;
}

export function codeInline(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

export function isTelegramMessageNotModifiedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const telegramError = error as Error & {
    response?: {
      description?: string;
    };
  };

  return telegramError.response?.description?.includes('message is not modified') ?? false;
}