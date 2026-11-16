import React, { useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  Link2,
  RefreshCw,
  RotateCcw,
  Sheet,
  CalendarDays,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  Layers,
} from 'lucide-react';
import {
  AppsScriptSyncResult,
  SyncConfig,
  WorkspaceArchitectureSnapshot,
} from '../types/honorarios';
import { validateAppsScriptUrl } from '../utils/honorariosLogic';
import { formatArchitectureReport } from '../utils/sheetArchitecture';

interface SettingsViewProps {
  config: SyncConfig;
  googleUserEmail: string | null;
  googleConnected: boolean;
  isSyncing: boolean;
  syncMessage: { type: 'success' | 'error'; text: string } | null;
  architectureSnapshot: WorkspaceArchitectureSnapshot | null;
  appsScriptSummary: AppsScriptSyncResult['summary'] | null;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onSyncGoogleWorkspace: (
    customSpreadsheetId?: string,
    overrideToken?: string,
    preferredTabTitle?: string
  ) => Promise<void>;
  onSelectSheetTab: (tabTitle: string) => void;
  onToggleReadOnlyMode: (readOnly: boolean) => void;
  onSyncAppsScript: (url: string) => Promise<void>;
  onResetDemo: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  config,
  googleUserEmail,
  googleConnected,
  isSyncing,
  syncMessage,
  architectureSnapshot,
  appsScriptSummary,
  onGoogleSignIn,
  onGoogleSignOut,
  onSyncGoogleWorkspace,
  onSelectSheetTab,
  onToggleReadOnlyMode,
  onSyncAppsScript,
  onResetDemo,
}) => {
  const [appsScriptInput, setAppsScriptInput] = useState(config.appsScriptUrl);
  const [spreadsheetIdInput, setSpreadsheetIdInput] = useState(
    config.spreadsheetId
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  const handleAppsScriptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateAppsScriptUrl(appsScriptInput);
    if (!validation.valid) {
      setUrlError(validation.error ?? 'URL inválida.');
      return;
    }
    setUrlError(null);
    await onSyncAppsScript(appsScriptInput.trim());
  };

  const handleCopyArchitecture = async () => {
    if (!architectureSnapshot) return;
    try {
      await navigator.clipboard.writeText(
        formatArchitectureReport(architectureSnapshot)
      );
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="border-b border-[#313131]/12 pb-5">
        <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#313131]">
          Configurações & Conexão Google
        </h1>
        <p className="mt-1.5 text-sm text-[#313131]/70">
          Conecte sua conta Google para ler a estrutura da planilha e das pastas
          no Drive em modo Somente Leitura e carregar os dados no painel.
        </p>
      </div>

      {syncMessage && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            syncMessage.type === 'success'
              ? 'border-emerald-700/25 bg-emerald-50 text-emerald-900'
              : 'border-red-700/25 bg-red-50 text-red-900'
          }`}
        >
          {syncMessage.text}
        </div>
      )}

      {/* Proteção Somente Leitura */}
      <section className="rounded-xl border border-[#8D6A14]/30 bg-white p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#F6F3EC] p-2.5 text-[#8D6A14] shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-serif text-base font-bold text-[#313131]">
              Proteção Somente Leitura{' '}
              <span className="ml-1.5 text-xs font-sans font-semibold text-emerald-800">
                {config.readOnlyMode ? '· Ativa' : '· Desativada (Gravação liberada)'}
              </span>
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[#313131]/70">
              {config.readOnlyMode
                ? 'A planilha oficial "Barreto — Honorários (Ads Família)" nunca é alterada. Quitações e alterações de data ficam apenas na visualização do sistema.'
                : 'Atenção: quitações e alterações de data também serão enviadas para a planilha e Google Calendar.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.readOnlyMode}
          onClick={() => onToggleReadOnlyMode(!config.readOnlyMode)}
          className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
            config.readOnlyMode
              ? 'border-[#313131] bg-[#313131] text-white hover:bg-[#313131]/90'
              : 'border-[#313131]/20 bg-[#F6F3EC] text-[#313131] hover:bg-[#313131]/10'
          }`}
        >
          {config.readOnlyMode ? 'Somente Leitura: Ligado' : 'Somente Leitura: Desligado'}
        </button>
      </section>

      {/* 1. Conexão Google Workspace */}
      <section className="rounded-xl border border-[#313131]/12 bg-white p-6 space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#313131]">
              1. Leitura Direta do Google Sheets & Drive
            </h2>
            <p className="mt-1 text-sm text-[#313131]/70">
              Localiza automaticamente a planilha{' '}
              <strong className="font-medium text-[#313131]">
                Barreto — Honorários (Ads Família)
              </strong>{' '}
              e a pasta{' '}
              <strong className="font-medium text-[#313131]">
                Clientes Tráfego Pago
              </strong>{' '}
              no seu Google Drive, lendo abas, colunas e pastas de clientes sem
              modificar nenhum arquivo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs text-[#313131]/75">
          <div className="flex items-center gap-2 rounded-lg bg-[#F6F3EC] px-3.5 py-2.5">
            <Sheet className="h-4 w-4 text-[#8D6A14] shrink-0" />
            <span>Google Sheets · Todas as abas</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-[#F6F3EC] px-3.5 py-2.5">
            <FolderOpen className="h-4 w-4 text-[#8D6A14] shrink-0" />
            <span>Drive · Clientes Tráfego Pago</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-[#F6F3EC] px-3.5 py-2.5">
            <CalendarDays className="h-4 w-4 text-[#8D6A14] shrink-0" />
            <span>Agenda · Referência 13h30–14h30</span>
          </div>
        </div>

        {!googleConnected ? (
          <div className="pt-1 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={isSyncing}
              className="gsi-material-button"
              aria-label="Entrar com Google para ler Sheets e Drive"
            >
              <div className="gsi-material-button-state" />
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  Entrar com o Google
                </span>
                <span style={{ display: 'none' }}>Entrar com o Google</span>
              </div>
            </button>
            <span className="text-xs text-[#313131]/65 leading-relaxed max-w-md">
              A leitura acontece diretamente no seu navegador após o login. Com
              o modo Somente Leitura ativo, nenhuma célula da sua planilha será
              modificada.
            </span>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-[#313131]/12 bg-[#F6F3EC] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                <span>
                  Conectado como{' '}
                  <strong className="font-semibold text-[#313131]">
                    {googleUserEmail}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={onGoogleSignOut}
                className="text-xs font-medium text-[#313131]/70 underline underline-offset-4 hover:text-[#313131]"
              >
                Desconectar conta
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
              <div className="sm:col-span-8">
                <label
                  htmlFor="google-spreadsheet-id"
                  className="block text-xs font-medium text-[#313131]/80"
                >
                  ID da planilha (opcional — busca automática por &ldquo;Barreto&rdquo;)
                </label>
                <input
                  id="google-spreadsheet-id"
                  type="text"
                  value={spreadsheetIdInput}
                  onChange={(e) => setSpreadsheetIdInput(e.target.value)}
                  placeholder="Deixe em branco para localizar automaticamente"
                  className="mt-1.5 w-full rounded-lg border border-[#313131]/20 bg-white px-3 py-2 text-sm text-[#313131] focus:border-[#DCB14A] focus:outline-none"
                />
              </div>
              <div className="sm:col-span-4">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() =>
                    onSyncGoogleWorkspace(spreadsheetIdInput.trim() || undefined)
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#313131] px-4 py-2 text-sm font-medium text-[#FFFFFF] hover:bg-[#313131]/90 disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw
                    className={`h-4 w-4 text-[#FFD559] ${
                      isSyncing ? 'animate-spin' : ''
                    }`}
                  />
                  {isSyncing ? 'Lendo...' : 'Ler Planilha & Drive'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Arquitetura Lida (Planilha & Google Drive) */}
      {architectureSnapshot && (
        <section className="rounded-xl border border-[#313131]/15 bg-white p-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8D6A14]">
                <Layers className="h-3.5 w-3.5" />
                <span>Leitura Somente Consulta</span>
              </div>
              <h2 className="mt-1 font-serif text-lg font-bold text-[#313131]">
                Arquitetura Lida: {architectureSnapshot.spreadsheetTitle}
              </h2>
              <p className="mt-1 text-xs text-[#313131]/70 tabular-nums">
                {architectureSnapshot.tabs.length} aba(s) analisada(s) · Aba
                ativa no painel:{' '}
                <strong className="text-[#313131]">
                  {architectureSnapshot.activeTabTitle}
                </strong>{' '}
                · {architectureSnapshot.parsedClientsCount} clientes e{' '}
                {architectureSnapshot.parsedInstallmentsCount} parcelas
                carregadas
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyArchitecture}
              className="inline-flex items-center gap-2 rounded-lg border border-[#313131]/20 bg-[#F6F3EC] px-3.5 py-2 text-xs font-medium text-[#313131] hover:bg-[#313131]/10 whitespace-nowrap shrink-0 self-start"
            >
              {copiedReport ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-700" />
                  Estrutura Copiada
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[#8D6A14]" />
                  Copiar Estrutura
                </>
              )}
            </button>
          </div>

          {/* Tabs discovered */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#313131]/65">
              Abas encontradas na planilha
            </h3>
            <div className="space-y-2.5">
              {architectureSnapshot.tabs.map((tab) => {
                const isActive =
                  tab.title === architectureSnapshot.activeTabTitle;
                return (
                  <div
                    key={tab.sheetId}
                    className={`rounded-lg border p-4 transition-colors ${
                      isActive
                        ? 'border-[#DCB14A] bg-[#F6F3EC]/70'
                        : 'border-[#313131]/12 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#313131]">
                          {tab.title}
                          {isActive && (
                            <span className="ml-2 text-xs font-medium text-[#8D6A14]">
                              (Aba em uso no Dashboard)
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-[#313131]/65 tabular-nums">
                          Cabeçalho detectado na linha {tab.headerRowNumber} ·{' '}
                          {tab.dataRowsCount} linha(s) com dados
                        </p>
                      </div>
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => onSelectSheetTab(tab.title)}
                          className="rounded-lg border border-[#313131]/20 bg-white px-3 py-1.5 text-xs font-medium text-[#313131] hover:bg-[#313131] hover:text-white whitespace-nowrap"
                        >
                          Usar esta aba no painel
                        </button>
                      )}
                    </div>

                    <div className="mt-3 text-xs text-[#313131]/75">
                      <span className="font-medium text-[#313131]">
                        Colunas ({tab.headers.length}):{' '}
                      </span>
                      {tab.headers.length > 0
                        ? tab.headers.join(' · ')
                        : 'Nenhuma coluna identificada nesta aba'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drive architecture discovered */}
          <div className="border-t border-[#313131]/12 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#313131]/65">
                Estrutura lida no Google Drive
              </h3>
              {architectureSnapshot.drive.rootFolderUrl && (
                <a
                  href={architectureSnapshot.drive.rootFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8D6A14] hover:underline"
                >
                  Abrir {architectureSnapshot.drive.rootFolderName}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {architectureSnapshot.drive.rootFolderId ? (
              <div className="rounded-lg bg-[#F6F3EC] p-4 space-y-2.5 text-xs text-[#313131]/80">
                <p>
                  Pasta localizada:{' '}
                  <strong className="text-[#313131]">
                    {architectureSnapshot.drive.rootFolderName}
                  </strong>{' '}
                  ·{' '}
                  <span className="tabular-nums">
                    {architectureSnapshot.drive.totalClientFoldersCount} pasta(s)
                    de clientes mapeada(s)
                  </span>
                </p>

                {architectureSnapshot.drive.stageFolders.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
                    {architectureSnapshot.drive.stageFolders.map((sf) => (
                      <a
                        key={sf.folderName}
                        href={sf.folderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-md border border-[#313131]/12 bg-white px-3 py-2 hover:border-[#DCB14A]"
                      >
                        <span className="font-medium text-[#313131] truncate">
                          {sf.folderName}
                        </span>
                        <span className="text-[#313131]/65 tabular-nums shrink-0 ml-2">
                          {sf.clientCount} clientes
                        </span>
                      </a>
                    ))}
                  </div>
                )}

                {architectureSnapshot.drive.sampleClientFolderNames.length >
                  0 && (
                  <p className="pt-1 text-[#313131]/70">
                    <strong className="text-[#313131]">
                      Exemplos de pastas encontradas:
                    </strong>{' '}
                    {architectureSnapshot.drive.sampleClientFolderNames
                      .slice(0, 8)
                      .join(', ')}
                    {architectureSnapshot.drive.totalClientFoldersCount > 8
                      ? '…'
                      : ''}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#313131]/70">
                A pasta &ldquo;Clientes Tráfego Pago&rdquo; não foi encontrada
                automaticamente nesta conta Google. Verifique se ela está
                compartilhada com o e-mail conectado.
              </p>
            )}
          </div>
        </section>
      )}

      {/* 2. URL do Web App do Google Apps Script */}
      <section className="rounded-xl border border-[#313131]/12 bg-white p-6 space-y-4">
        <div>
          <h2 className="font-serif text-lg font-bold text-[#313131]">
            2. Web App do Google Apps Script
          </h2>
          <p className="mt-1 text-sm text-[#313131]/70">
            Se o escritório utiliza um script publicado na planilha para integrar
            Google Sheets, Calendar e Drive em um único endereço, cole a URL
            abaixo.
          </p>
        </div>

        <form onSubmit={handleAppsScriptSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="apps-script-url"
              className="block text-xs font-medium text-[#313131]/80"
            >
              URL do Web App do Google Apps Script
            </label>
            <div className="mt-1.5 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#313131]/45" />
                <input
                  id="apps-script-url"
                  type="url"
                  value={appsScriptInput}
                  onChange={(e) => {
                    setAppsScriptInput(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC] py-2.5 pl-9 pr-3 text-sm text-[#313131] placeholder:text-[#313131]/45 focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSyncing}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#313131] px-5 py-2.5 text-sm font-medium text-[#FFFFFF] hover:bg-[#313131]/90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-4 w-4 text-[#FFD559] ${
                    isSyncing ? 'animate-spin' : ''
                  }`}
                />
                {isSyncing ? 'Sincronizando Drive e Planilha...' : 'Sincronizar Agora'}
              </button>
            </div>
            {urlError && (
              <p className="mt-2 text-xs text-red-700" role="alert">
                {urlError}
              </p>
            )}
          </div>
        </form>

        <div className="rounded-lg bg-[#F6F3EC] p-4 text-xs leading-relaxed text-[#313131]/75 space-y-1">
          <p className="font-semibold text-[#313131]">
            Leitura via GET em Modo Somente Leitura:
          </p>
          <p>
            Ao clicar em <strong>Sincronizar Agora</strong>, o painel consulta a
            URL <code>/exec</code> exclusivamente via <strong>GET</strong>,
            mapeando <code>clientes</code>, <code>parcelas</code>,{' '}
            <code>driveEtapas</code> e <code>eventosAgenda</code> sem enviar
            nenhuma modificação para a planilha ou agenda.
          </p>
        </div>

        {appsScriptSummary && (
          <div
            className="rounded-lg border border-[#DCB14A]/45 bg-[#F6F3EC]/70 p-4 space-y-2"
            data-testid="apps-script-sync-summary"
          >
            <p className="text-xs font-semibold text-[#313131]">
              Última leitura da Planilha Real (Somente Leitura)
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-md bg-white px-3 py-2 border border-[#313131]/10">
                <p className="text-[#313131]/60">Clientes</p>
                <p className="mt-0.5 text-sm font-bold text-[#313131] tabular-nums">
                  {appsScriptSummary.clientesCount}
                </p>
              </div>
              <div className="rounded-md bg-white px-3 py-2 border border-[#313131]/10">
                <p className="text-[#313131]/60">Parcelas</p>
                <p className="mt-0.5 text-sm font-bold text-[#313131] tabular-nums">
                  {appsScriptSummary.parcelasCount}
                </p>
              </div>
              <div className="rounded-md bg-white px-3 py-2 border border-[#313131]/10">
                <p className="text-[#313131]/60">Drive cruzado</p>
                <p className="mt-0.5 text-sm font-bold text-[#313131] tabular-nums">
                  {appsScriptSummary.matchedDriveCount}/
                  {appsScriptSummary.driveEtapasCount}
                </p>
                <p className="text-[11px] text-[#313131]/60 tabular-nums">
                  {appsScriptSummary.driveFilesCount} arquivo(s)
                </p>
              </div>
              <div className="rounded-md bg-white px-3 py-2 border border-[#313131]/10">
                <p className="text-[#313131]/60">Eventos Agenda</p>
                <p className="mt-0.5 text-sm font-bold text-[#313131] tabular-nums">
                  {appsScriptSummary.eventosAgendaCount}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3. Modo de Demonstração */}
      <section className="rounded-xl border border-[#313131]/12 bg-white p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-base font-bold text-[#313131]">
            Base de Demonstração (Direito de Família)
          </h2>
          <p className="mt-1 text-xs text-[#313131]/65">
            Restaura os dados de teste com vencimentos agrupados nos dias 10,
            15, 17, 18, 20, 23, 27 e 30.
          </p>
          {config.lastSyncedAt && (
            <p className="mt-1 text-xs text-[#313131]/55 tabular-nums">
              Última sincronização:{' '}
              {new Date(config.lastSyncedAt).toLocaleString('pt-BR')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onResetDemo}
          className="inline-flex items-center gap-2 rounded-lg border border-[#313131]/20 bg-white px-4 py-2 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <RotateCcw className="h-3.5 w-3.5 text-[#8D6A14]" />
          Restaurar Dados de Teste
        </button>
      </section>
    </div>
  );
};
