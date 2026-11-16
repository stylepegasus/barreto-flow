export const AUTHORIZED_EMAILS = [
  'stylepegasus.snkrs@gmail.com',
  'barretoadvocacia01@gmail.com',
  'agendabarretoadvocacia@gmail.com',
] as const;

const AUTHORIZED_EMAIL_SET = new Set<string>(AUTHORIZED_EMAILS);

export const UNAUTHORIZED_USER_MESSAGE =
  'PODE FECHAR A ABA! VOCÊ NÃO ESTÁ AUTORIZADO, MALANDRO(a)!';

export function normalizeEmail(email: string | null | undefined): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isAuthorizedEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return AUTHORIZED_EMAIL_SET.has(normalized);
}
