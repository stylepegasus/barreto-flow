import React from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { UNAUTHORIZED_USER_MESSAGE } from '../utils/authAllowlist';

interface LoginViewProps {
  status: 'checking' | 'unauthenticated' | 'unauthorized';
  isSigningIn: boolean;
  rejectedEmail: string | null;
  errorMessage: string | null;
  onSignInWithGoogle: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  status,
  isSigningIn,
  rejectedEmail,
  errorMessage,
  onSignInWithGoogle,
}) => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F3EC] px-4 py-10 text-[#313131]">
      <div
        data-testid="login-card"
        className="w-full max-w-[460px] rounded-2xl border border-[#313131]/12 bg-white shadow-sm overflow-hidden"
      >
        <div className="h-1 w-full bg-gradient-to-r from-[#313131] via-[#DCB14A] to-[#313131]" />

        <div className="p-8 sm:p-10 space-y-6 text-center">
          <div className="flex flex-col items-center space-y-4">
            <BrandMark size="lg" />
            <div className="space-y-1.5">
              <h1 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-[#313131]">
                Barreto Flow — Acesso Restrito
              </h1>
              <p className="font-serif text-xs italic text-[#313131]/70">
                Compromisso com o Direito. Excelência no Resultado.
              </p>
            </div>
          </div>

          {status === 'checking' ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-6 w-6 animate-spin text-[#DCB14A]" />
              <p className="text-xs font-medium text-[#313131]/70">
                Verificando sessão autorizada...
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {status === 'unauthorized' ? (
                <div
                  role="alert"
                  data-testid="unauthorized-alert"
                  className="rounded-xl border-2 border-red-700/45 bg-red-50 px-5 py-4 text-center space-y-2"
                >
                  <div className="flex items-center justify-center gap-2 text-red-800">
                    <ShieldAlert className="h-5 w-5 shrink-0" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">
                      Acesso Bloqueado
                    </span>
                  </div>
                  <p className="text-sm font-bold leading-snug text-red-900">
                    {UNAUTHORIZED_USER_MESSAGE}
                  </p>
                  {rejectedEmail && (
                    <p className="text-xs text-red-800/80 break-all">
                      Conta utilizada: <strong>{rejectedEmail}</strong>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-[#313131]/75">
                  Ambiente interno da Barreto Advocacia Especializada. Utilize
                  uma conta Google autorizada para acessar o painel de honorários.
                </p>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-700/25 bg-red-50/80 px-4 py-2.5 text-xs text-red-900"
                >
                  {errorMessage}
                </div>
              )}

              {status === 'unauthorized' ? (
                <button
                  type="button"
                  onClick={onSignInWithGoogle}
                  disabled={isSigningIn}
                  data-testid="retry-google-login-btn"
                  className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#313131]/25 bg-[#F6F3EC] px-4 py-2.5 text-xs font-semibold text-[#313131] transition-colors hover:border-[#DCB14A] hover:bg-white disabled:opacity-60"
                >
                  {isSigningIn ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#8D6A14]" />
                  ) : (
                    <GoogleMarkIcon />
                  )}
                  <span>
                    {isSigningIn
                      ? 'Verificando conta...'
                      : 'Entrar com outra conta Google'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignInWithGoogle}
                  disabled={isSigningIn}
                  data-testid="google-login-btn"
                  className="inline-flex w-full items-center justify-center gap-3 rounded-lg bg-[#313131] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#313131]/92 focus-visible:outline-2 focus-visible:outline-[#DCB14A] disabled:opacity-60"
                >
                  {isSigningIn ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#FFD559]" />
                  ) : (
                    <GoogleMarkIcon />
                  )}
                  <span>
                    {isSigningIn ? 'Conectando...' : 'Entrar com o Google'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="mt-6 text-[11px] text-[#313131]/55">
        Barreto Advocacia Especializada · Acesso exclusivo à equipe autorizada
      </p>
    </div>
  );
};

const GoogleMarkIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4 shrink-0"
  >
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
    />
    <path
      fill="#34A853"
      d="M3.5 7.4l3.2 2.3C7.6 7.5 9.6 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 8.3 2.5 5.1 4.6 3.5 7.4z"
    />
    <path
      fill="#FBBC05"
      d="M12 21.5c2.5 0 4.7-.8 6.3-2.3l-2.9-2.4c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.2 2.5c1.6 3.2 4.9 5.3 8.8 5.3z"
    />
    <path
      fill="#4285F4"
      d="M21.1 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.3 1.4-1.1 2.4-2.1 3.1l2.9 2.4c1.7-1.6 2.9-4 2.9-7.8z"
    />
  </svg>
);
