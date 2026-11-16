/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Menu } from 'lucide-react';
import {
  ActiveTab,
  AppsScriptCalendarEventRow,
  AppsScriptSyncResult,
  ChatMessage,
  ClientCase,
  DriveArchitectureSummary,
  DriveFileItem,
  InstallmentWithStatus,
  SimulatorInputs,
  SimulatorPresetId,
  SyncConfig,
  WorkspaceArchitectureSnapshot,
  ZapSignSignedDoc,
  ZapSignState,
} from './types/honorarios';
import {
  formatCurrencyBRL,
  formatDateBR,
  getTodayISO,
  markInstallmentPaid,
  rescheduleInstallment,
} from './utils/honorariosLogic';
import {
  buildProjectionsChartData,
  calculateSimulatorOutputs,
  computePortfolioBaseline,
  DEFAULT_MONTHLY_GOAL,
  getMonthSequence,
  getPresetSimulatorInputs,
} from './utils/projectionsLogic';
import { matchZapSignToClients } from './utils/zapsignLogic';
import { AssistantContextExtras } from './utils/assistantContext';
import { parseSheetTabToClients } from './utils/sheetArchitecture';
import { createDemoClients } from './data/demoData';
import {
  getWorkspaceAccessToken,
  initGoogleAuth,
  signInWithGoogleWorkspace,
  signOutGoogleWorkspace,
} from './services/googleAuth';
import {
  discoverBarretoWorkspace,
  inspectAndFetchGoogleSheet,
  postActionToAppsScript,
  syncCalendarBillingEvent,
  syncFromAppsScriptUrl,
  updateInstallmentInGoogleSheet,
} from './services/googleWorkspace';
import { Sidebar } from './components/Sidebar';
import { BrandMark } from './components/BrandMark';
import { DashboardView } from './components/DashboardView';
import { CalendarView } from './components/CalendarView';
import { ClientsView } from './components/ClientsView';
import { ProjectionsView } from './components/ProjectionsView';
import { SettingsView } from './components/SettingsView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { WhatsAppModal } from './components/WhatsAppModal';
import { RescheduleModal } from './components/RescheduleModal';
import {
  AssistantChatWidget,
  PendingDocumentAnalysisRequest,
} from './components/AssistantChatWidget';

const STORAGE_CONFIG_KEY = 'barreto_honorarios_config_v1';
const STORAGE_DEMO_CLIENTS_KEY = 'barreto_honorarios_demo_clients_v1';
const STORAGE_GOALS_KEY = 'barreto_honorarios_goals_v1';
const STORAGE_SIMULATOR_KEY = 'barreto_honorarios_simulator_v1';
const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxz9gSeBsBVBAWNbLZOn4S4NSWQop7sk7FokMc_0bFzDqdLxRzGlmkDYAe1fFA5ruM2wA/exec';

interface PendingConfirmAction {
  type: 'pay' | 'reschedule';
  item: InstallmentWithStatus;
  newDueDateISO?: string;
}

export default function App() {
  const todayISO = useMemo(() => getTodayISO(), []);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [config, setConfig] = useState<SyncConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SyncConfig>;
        return {
          appsScriptUrl: parsed.appsScriptUrl || DEFAULT_APPS_SCRIPT_URL,
          spreadsheetId: parsed.spreadsheetId ?? '',
          spreadsheetName:
            parsed.spreadsheetName ?? 'Barreto — Honorários (Ads Família)',
          driveRootFolderName: 'Clientes Tráfego Pago',
          lastSyncedAt: parsed.lastSyncedAt ?? null,
          sourceMode: parsed.sourceMode ?? 'demo',
          readOnlyMode: parsed.readOnlyMode ?? true,
        };
      }
    } catch {
      // ignore storage errors
    }
    return {
      appsScriptUrl: DEFAULT_APPS_SCRIPT_URL,
      spreadsheetId: '',
      spreadsheetName: 'Barreto — Honorários (Ads Família)',
      driveRootFolderName: 'Clientes Tráfego Pago',
      lastSyncedAt: null,
      sourceMode: 'demo',
      readOnlyMode: true,
    };
  });

  const [clients, setClients] = useState<ClientCase[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DEMO_CLIENTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ClientCase[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return createDemoClients(todayISO);
  });

  const [sheetTabTitle, setSheetTabTitle] = useState<string>('Página1');
  const [architectureSnapshot, setArchitectureSnapshot] =
    useState<WorkspaceArchitectureSnapshot | null>(null);
  const [appsScriptSummary, setAppsScriptSummary] = useState<
    AppsScriptSyncResult['summary'] | null
  >(null);
  const [cachedTabRowsByTitle, setCachedTabRowsByTitle] = useState<
    Record<string, unknown[][]>
  >({});
  const [cachedDriveSummary, setCachedDriveSummary] =
    useState<DriveArchitectureSummary | null>(null);

  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [whatsAppItem, setWhatsAppItem] =
    useState<InstallmentWithStatus | null>(null);
  const [rescheduleItem, setRescheduleItem] =
    useState<InstallmentWithStatus | null>(null);
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingConfirmAction | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const [calendarEvents, setCalendarEvents] = useState<
    AppsScriptCalendarEventRow[]
  >([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingDocumentRequest, setPendingDocumentRequest] =
    useState<PendingDocumentAnalysisRequest | null>(null);

  const currentMonthKey = todayISO.slice(0, 7);

  const baseline = useMemo(
    () => computePortfolioBaseline(clients, todayISO),
    [clients, todayISO]
  );

  const [goalsByMonth, setGoalsByMonth] = useState<Record<string, number>>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_GOALS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Record<string, number>;
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }
      } catch {
        // ignore storage errors
      }
      return {};
    }
  );

  const [activePreset, setActivePreset] = useState<
    SimulatorPresetId | 'custom'
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SIMULATOR_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          preset?: SimulatorPresetId | 'custom';
        };
        if (parsed.preset) return parsed.preset;
      }
    } catch {
      // ignore storage errors
    }
    return 'meta';
  });

  const [simulatorInputs, setSimulatorInputs] = useState<SimulatorInputs>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_SIMULATOR_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            inputs?: Partial<SimulatorInputs>;
          };
          if (parsed.inputs && typeof parsed.inputs.monthlyAdsSpend === 'number') {
            return {
              ...getPresetSimulatorInputs('meta', baseline),
              ...parsed.inputs,
            };
          }
        }
      } catch {
        // ignore storage errors
      }
      return getPresetSimulatorInputs('meta', baseline);
    }
  );

  const [zapSignState, setZapSignState] = useState<ZapSignState>({
    configured: false,
    loading: false,
    docs: [],
    error: null,
    lastFetchedAt: null,
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
    } catch {
      // ignore storage errors
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_GOALS_KEY, JSON.stringify(goalsByMonth));
    } catch {
      // ignore storage errors
    }
  }, [goalsByMonth]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_SIMULATOR_KEY,
        JSON.stringify({ preset: activePreset, inputs: simulatorInputs })
      );
    } catch {
      // ignore storage errors
    }
  }, [activePreset, simulatorInputs]);

  useEffect(() => {
    if (config.sourceMode === 'demo') {
      try {
        localStorage.setItem(STORAGE_DEMO_CLIENTS_KEY, JSON.stringify(clients));
      } catch {
        // ignore storage errors
      }
    }
  }, [clients, config.sourceMode]);

  const fetchZapSignSigned = useCallback(async () => {
    setZapSignState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch('/api/zapsign/signed');
      const payload = (await res.json().catch(() => ({}))) as {
        configured?: boolean;
        docs?: ZapSignSignedDoc[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          payload.error || 'Erro ao consultar documentos assinados no ZapSign.'
        );
      }
      setZapSignState({
        configured: Boolean(payload.configured),
        loading: false,
        docs: Array.isArray(payload.docs) ? payload.docs : [],
        error: null,
        lastFetchedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      setZapSignState((prev) => ({
        ...prev,
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : 'Falha ao consultar o ZapSign.',
      }));
    }
  }, []);

  useEffect(() => {
    void fetchZapSignSigned();
  }, [fetchZapSignSigned]);

  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user) => {
        setGoogleUserEmail(user.email ?? user.displayName ?? 'Conta Google');
        setGoogleConnected(true);
      },
      (user) => {
        setGoogleUserEmail(user?.email ?? null);
        setGoogleConnected(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => {
      setActionFeedback((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  const handleSyncGoogleWorkspace = async (
    customSpreadsheetId?: string,
    overrideToken?: string,
    preferredTabTitle?: string
  ) => {
    const token = overrideToken ?? getWorkspaceAccessToken();
    if (!token) {
      setSyncMessage({
        type: 'error',
        text: 'Faça login com sua conta Google antes de ler a planilha.',
      });
      return;
    }

    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const discovery = await discoverBarretoWorkspace(
        token,
        config.spreadsheetName,
        config.driveRootFolderName
      );
      const targetSpreadsheetId =
        customSpreadsheetId || discovery.spreadsheetId;

      setCachedDriveSummary(discovery.driveSummary);

      if (!targetSpreadsheetId) {
        setSyncMessage({
          type: 'error',
          text: 'Nenhuma planilha chamada "Barreto — Honorários (Ads Família)" foi encontrada no Google Drive desta conta. Informe o ID manualmente ou use a base de demonstração.',
        });
        return;
      }

      const sheetResult = await inspectAndFetchGoogleSheet(
        token,
        targetSpreadsheetId,
        discovery.driveSummary,
        preferredTabTitle
      );

      const parsedInstallmentsCount = sheetResult.clients.reduce(
        (sum, c) => sum + c.installments.length,
        0
      );

      setCachedTabRowsByTitle(sheetResult.tabRowsByTitle);
      setArchitectureSnapshot({
        inspectedAt: new Date().toISOString(),
        spreadsheetId: targetSpreadsheetId,
        spreadsheetTitle: sheetResult.spreadsheetTitle,
        activeTabTitle: sheetResult.activeTabTitle,
        tabs: sheetResult.tabs,
        drive: discovery.driveSummary,
        parsedClientsCount: sheetResult.clients.length,
        parsedInstallmentsCount,
      });

      setSheetTabTitle(sheetResult.activeTabTitle);

      if (sheetResult.clients.length === 0) {
        setSyncMessage({
          type: 'error',
          text: `Estrutura da planilha "${sheetResult.spreadsheetTitle}" lida em Somente Leitura (${sheetResult.tabs.length} aba(s)), mas nenhuma linha de cliente foi extraída da aba "${sheetResult.activeTabTitle}". Selecione outra aba abaixo ou confira as colunas detectadas.`,
        });
        return;
      }

      setClients(sheetResult.clients);
      setConfig((prev) => ({
        ...prev,
        spreadsheetId: targetSpreadsheetId,
        spreadsheetName: sheetResult.spreadsheetTitle,
        lastSyncedAt: new Date().toISOString(),
        sourceMode: 'google_workspace',
      }));
      setSyncMessage({
        type: 'success',
        text: `Leitura concluída em modo Somente Leitura: ${sheetResult.clients.length} clientes e ${parsedInstallmentsCount} parcelas carregadas da aba "${sheetResult.activeTabTitle}".`,
      });
    } catch (err: any) {
      setSyncMessage({
        type: 'error',
        text:
          err?.message ??
          'Erro ao ler os dados no Google Sheets e Google Drive.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSelectSheetTab = (tabTitle: string) => {
    const rows = cachedTabRowsByTitle[tabTitle];
    if (!rows || !architectureSnapshot) return;

    const parsedClients = parseSheetTabToClients(
      rows,
      cachedDriveSummary ?? undefined,
      todayISO
    );
    const parsedInstallmentsCount = parsedClients.reduce(
      (sum, c) => sum + c.installments.length,
      0
    );

    setSheetTabTitle(tabTitle);
    setArchitectureSnapshot((prev) =>
      prev
        ? {
            ...prev,
            activeTabTitle: tabTitle,
            parsedClientsCount: parsedClients.length,
            parsedInstallmentsCount,
          }
        : null
    );

    if (parsedClients.length > 0) {
      setClients(parsedClients);
      setConfig((prev) => ({
        ...prev,
        sourceMode: 'google_workspace',
        lastSyncedAt: new Date().toISOString(),
      }));
      setSyncMessage({
        type: 'success',
        text: `Aba "${tabTitle}" carregada no painel (${parsedClients.length} clientes, ${parsedInstallmentsCount} parcelas) em Somente Leitura.`,
      });
    } else {
      setSyncMessage({
        type: 'error',
        text: `A aba "${tabTitle}" foi analisada, mas não possui colunas de clientes/valores reconhecidas para o Dashboard.`,
      });
    }
  };

  const handleToggleReadOnlyMode = (readOnly: boolean) => {
    setConfig((prev) => ({ ...prev, readOnlyMode: readOnly }));
    showToast(
      readOnly
        ? 'Proteção Somente Leitura ativada: a planilha oficial não será alterada.'
        : 'Modo de gravação ativado: alterações poderão atualizar planilha e agenda.'
    );
  };

  const handleGoogleSignIn = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const { user, accessToken } = await signInWithGoogleWorkspace();
      setGoogleUserEmail(user.email ?? user.displayName ?? 'Conta Google');
      setGoogleConnected(true);
      await handleSyncGoogleWorkspace(undefined, accessToken);
    } catch (err: any) {
      setSyncMessage({
        type: 'error',
        text:
          err?.message ??
          'Não foi possível concluir o login com o Google.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogleWorkspace();
    setGoogleUserEmail(null);
    setGoogleConnected(false);
    setArchitectureSnapshot(null);
    setCachedTabRowsByTitle({});
    setCachedDriveSummary(null);
    if (config.sourceMode === 'google_workspace') {
      setConfig((prev) => ({ ...prev, sourceMode: 'demo' }));
      setClients(createDemoClients(todayISO));
    }
    setSyncMessage({
      type: 'success',
      text: 'Conta Google desconectada. Exibindo dados de demonstração.',
    });
  };

  const handleSyncAppsScript = async (url: string) => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncFromAppsScriptUrl(url);
      if (result.clients.length === 0) {
        setSyncMessage({
          type: 'error',
          text: 'O Web App respondeu, mas não retornou registros de clientes.',
        });
        return;
      }
      setClients(result.clients);
      setCalendarEvents(result.calendarEvents);
      setAppsScriptSummary(result.summary);
      setConfig((prev) => ({
        ...prev,
        appsScriptUrl: url,
        lastSyncedAt: new Date().toISOString(),
        sourceMode: 'apps_script',
        readOnlyMode: true,
      }));
      setSyncMessage({
        type: 'success',
        text: `Planilha real sincronizada via GET (Somente Leitura): ${result.summary.clientesCount} clientes, ${result.summary.parcelasCount} parcelas, ${result.summary.matchedDriveCount} pastas do Drive (${result.summary.driveFilesCount} arquivos) e ${result.summary.eventosAgendaCount} eventos na agenda.`,
      });
    } catch (err: any) {
      setSyncMessage({
        type: 'error',
        text:
          err?.message ??
          'Não foi possível conectar à URL do Google Apps Script informada.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResetDemo = () => {
    const fresh = createDemoClients(todayISO);
    setClients(fresh);
    setCalendarEvents([]);
    setAppsScriptSummary(null);
    setConfig((prev) => ({
      ...prev,
      sourceMode: 'demo',
      lastSyncedAt: null,
    }));
    setSyncMessage({
      type: 'success',
      text: 'Dados de demonstração de Direito de Família restaurados.',
    });
  };

  const handleAnalyzeDocument = (client: ClientCase, file: DriveFileItem) => {
    setPendingDocumentRequest({
      requestId: `doc-${file.id}-${Date.now()}`,
      client,
      file,
    });
    setChatOpen(true);
  };

  const requestMarkPaid = (item: InstallmentWithStatus) => {
    setPendingConfirm({ type: 'pay', item });
  };

  const requestRescheduleConfirm = (
    item: InstallmentWithStatus,
    newDueDateISO: string
  ) => {
    setRescheduleItem(null);
    setPendingConfirm({ type: 'reschedule', item, newDueDateISO });
  };

  const executeConfirmedAction = async () => {
    if (!pendingConfirm) return;
    setIsSavingAction(true);

    const { type, item, newDueDateISO } = pendingConfirm;

    try {
      const accessToken = getWorkspaceAccessToken();
      if (!config.readOnlyMode) {
        if (
          config.sourceMode === 'google_workspace' &&
          accessToken &&
          config.spreadsheetId
        ) {
          if (type === 'pay' && item.sheetRowNumber) {
            await updateInstallmentInGoogleSheet(
              accessToken,
              config.spreadsheetId,
              sheetTabTitle,
              item.sheetRowNumber,
              { statusOrPaidDate: formatDateBR(todayISO) }
            );
          } else if (type === 'reschedule' && newDueDateISO) {
            if (item.sheetRowNumber) {
              await updateInstallmentInGoogleSheet(
                accessToken,
                config.spreadsheetId,
                sheetTabTitle,
                item.sheetRowNumber,
                { newDueDate: formatDateBR(newDueDateISO) }
              );
            }
            await syncCalendarBillingEvent(accessToken, {
              summary: `Cobrança Honorários — ${item.clientName}`,
              description: `Parcela ${item.installmentNumber}/${item.totalInstallments} (${formatCurrencyBRL(item.amount)})`,
              dateISO: newDueDateISO,
              eventId: item.calendarEventId,
            });
          }
        } else if (
          config.sourceMode === 'apps_script' &&
          config.appsScriptUrl
        ) {
          await postActionToAppsScript(config.appsScriptUrl, {
            action: type === 'pay' ? 'mark_paid' : 'reschedule',
            installmentId: item.id,
            clientId: item.clientId,
            paidDate: type === 'pay' ? todayISO : undefined,
            newDueDate: newDueDateISO,
          });
        }
      }

      if (type === 'pay') {
        setClients((prev) => markInstallmentPaid(prev, item.id, todayISO));
        showToast(
          config.readOnlyMode && config.sourceMode !== 'demo'
            ? `Parcela ${item.installmentNumber}/${item.totalInstallments} de ${item.clientName} marcada como paga no painel (planilha oficial intacta).`
            : `Parcela ${item.installmentNumber}/${item.totalInstallments} de ${item.clientName} marcada como paga.`
        );
      } else if (type === 'reschedule' && newDueDateISO) {
        setClients((prev) =>
          rescheduleInstallment(prev, item.id, newDueDateISO)
        );
        showToast(
          config.readOnlyMode && config.sourceMode !== 'demo'
            ? `Vencimento de ${item.clientName} alterado para ${formatDateBR(newDueDateISO)} no painel (planilha oficial intacta).`
            : `Vencimento de ${item.clientName} alterado para ${formatDateBR(newDueDateISO)}.`
        );
      }
    } catch (err: any) {
      showToast(
        err?.message ??
          'Não foi possível concluir a atualização nos serviços Google.'
      );
    } finally {
      setIsSavingAction(false);
      setPendingConfirm(null);
    }
  };

  const simulatorOutputs = useMemo(
    () => calculateSimulatorOutputs(simulatorInputs),
    [simulatorInputs]
  );

  const projectionsChartData = useMemo(
    () =>
      buildProjectionsChartData(
        clients,
        goalsByMonth,
        simulatorInputs,
        simulatorOutputs,
        currentMonthKey,
        DEFAULT_MONTHLY_GOAL
      ),
    [
      clients,
      goalsByMonth,
      simulatorInputs,
      simulatorOutputs,
      currentMonthKey,
    ]
  );

  const zapSignMatchResult = useMemo(
    () => matchZapSignToClients(clients, zapSignState.docs),
    [clients, zapSignState.docs]
  );

  const assistantContextExtras: AssistantContextExtras = useMemo(
    () => ({
      goalsByMonth,
      defaultGoal: DEFAULT_MONTHLY_GOAL,
      simulatorInputs,
      simulatorOutputs,
      zapSignDocs: zapSignState.docs,
      unmatchedZapSignDocs: zapSignMatchResult.unmatchedDocs,
    }),
    [
      goalsByMonth,
      simulatorInputs,
      simulatorOutputs,
      zapSignState.docs,
      zapSignMatchResult.unmatchedDocs,
    ]
  );

  const handleGoalChange = (monthKey: string, value: number) => {
    const sanitized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    setGoalsByMonth((prev) => ({ ...prev, [monthKey]: sanitized }));
  };

  const handleApplyDefaultGoalToUpcoming = (goalValue: number) => {
    const sanitized = Number.isFinite(goalValue)
      ? Math.max(0, Math.round(goalValue))
      : DEFAULT_MONTHLY_GOAL;
    const sequence = getMonthSequence(currentMonthKey, 0, 6);
    setGoalsByMonth((prev) => {
      const next = { ...prev };
      for (const item of sequence) {
        next[item.monthKey] = sanitized;
      }
      return next;
    });
    showToast(
      `Meta de ${formatCurrencyBRL(sanitized)} aplicada para o mês atual e os próximos 6 meses.`
    );
  };

  const handleSelectSimulatorPreset = (preset: SimulatorPresetId) => {
    setActivePreset(preset);
    setSimulatorInputs(getPresetSimulatorInputs(preset, baseline));
  };

  const handleUpdateSimulatorInputs = (patch: Partial<SimulatorInputs>) => {
    setActivePreset('custom');
    setSimulatorInputs((prev) => ({ ...prev, ...patch }));
  };

  const handleResetSimulatorBaseline = () => {
    setActivePreset('meta');
    setSimulatorInputs(getPresetSimulatorInputs('meta', baseline));
    showToast('Parâmetros do simulador recalibrados com os dados reais da carteira.');
  };

  const hasGoogleSync =
    config.sourceMode === 'google_workspace' ||
    config.sourceMode === 'apps_script';

  return (
    <div className="min-h-screen flex bg-[#F6F3EC] text-[#313131]">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        sourceMode={config.sourceMode}
        readOnlyMode={config.readOnlyMode}
        googleUserEmail={googleUserEmail}
        onGoogleSignOut={handleGoogleSignOut}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top Bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-[#313131] px-4 py-2.5 text-[#F6F3EC] lg:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
            className="rounded-md p-2 text-[#F6F3EC] hover:bg-white/10"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2.5">
            <BrandMark size="sm" />
            <span className="font-serif text-base font-bold tracking-tight text-[#FFFFFF] whitespace-nowrap">
              Barreto Advocacia
            </span>
          </div>
          <span className="w-9" aria-hidden="true" />
        </header>

        {/* Action Feedback Banner */}
        {actionFeedback && (
          <div
            role="status"
            className="mx-4 mt-4 sm:mx-8 lg:mx-10 rounded-lg border border-[#DCB14A] bg-white px-4 py-2.5 text-xs font-medium text-[#313131] shadow-sm"
          >
            {actionFeedback}
          </div>
        )}

        <main className="flex-1 px-4 pt-6 pb-24 sm:px-8 sm:pt-8 lg:px-10 lg:pt-10 max-w-[1400px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              clients={clients}
              todayISO={todayISO}
              unmatchedZapSignDocs={zapSignMatchResult.unmatchedDocs}
              zapSignSignedCount={zapSignState.docs.length}
              onMarkPaid={requestMarkPaid}
              onOpenWhatsApp={setWhatsAppItem}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'calendario' && (
            <CalendarView
              clients={clients}
              todayISO={todayISO}
              onQuitarParcela={requestMarkPaid}
              onAlterarData={setRescheduleItem}
              onOpenWhatsApp={setWhatsAppItem}
            />
          )}

          {activeTab === 'metas' && (
            <ProjectionsView
              currentMonthKey={currentMonthKey}
              baseline={baseline}
              goalsByMonth={goalsByMonth}
              defaultGoal={DEFAULT_MONTHLY_GOAL}
              onGoalChange={handleGoalChange}
              onApplyDefaultGoalToUpcoming={handleApplyDefaultGoalToUpcoming}
              activePreset={activePreset}
              simulatorInputs={simulatorInputs}
              simulatorOutputs={simulatorOutputs}
              chartData={projectionsChartData}
              onSelectPreset={handleSelectSimulatorPreset}
              onUpdateSimulatorInputs={handleUpdateSimulatorInputs}
              onResetSimulatorBaseline={handleResetSimulatorBaseline}
            />
          )}

          {activeTab === 'clientes' && (
            <ClientsView
              clients={clients}
              todayISO={todayISO}
              zapSignState={zapSignState}
              matchedZapSignByClientId={zapSignMatchResult.matchedByClientId}
              unmatchedZapSignDocs={zapSignMatchResult.unmatchedDocs}
              onRefreshZapSign={fetchZapSignSigned}
              onQuitarParcela={requestMarkPaid}
              onAlterarData={setRescheduleItem}
              onAnalyzeDocument={handleAnalyzeDocument}
            />
          )}

          {activeTab === 'configuracoes' && (
            <SettingsView
              config={config}
              googleUserEmail={googleUserEmail}
              googleConnected={googleConnected}
              isSyncing={isSyncing}
              syncMessage={syncMessage}
              architectureSnapshot={architectureSnapshot}
              appsScriptSummary={appsScriptSummary}
              onGoogleSignIn={handleGoogleSignIn}
              onGoogleSignOut={handleGoogleSignOut}
              onSyncGoogleWorkspace={handleSyncGoogleWorkspace}
              onSelectSheetTab={handleSelectSheetTab}
              onToggleReadOnlyMode={handleToggleReadOnlyMode}
              onSyncAppsScript={handleSyncAppsScript}
              onResetDemo={handleResetDemo}
            />
          )}
        </main>
      </div>

      {/* WhatsApp Composer Modal */}
      <WhatsAppModal
        item={whatsAppItem}
        onClose={() => setWhatsAppItem(null)}
      />

      {/* Reschedule Date Modal */}
      <RescheduleModal
        item={rescheduleItem}
        hasGoogleSync={hasGoogleSync}
        readOnlyMode={config.readOnlyMode}
        onConfirm={requestRescheduleConfirm}
        onClose={() => setRescheduleItem(null)}
      />

      {/* Confirmation Dialog for Pay / Reschedule */}
      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        busy={isSavingAction}
        title={
          pendingConfirm?.type === 'pay'
            ? 'Confirmar Quitação da Parcela'
            : 'Confirmar Alteração de Data'
        }
        description={
          pendingConfirm?.type === 'pay'
            ? hasGoogleSync
              ? config.readOnlyMode
                ? 'Modo Somente Leitura ativo: a quitação será registrada apenas na visualização do painel e não alterará a planilha oficial.'
                : 'Deseja registrar o pagamento desta parcela? O status também será atualizado na planilha conectada.'
              : 'Deseja registrar o pagamento desta parcela como quitada hoje?'
            : hasGoogleSync
              ? config.readOnlyMode
                ? 'Modo Somente Leitura ativo: a nova data será aplicada apenas na visualização do painel e não modificará a planilha oficial.'
                : 'Deseja alterar a data de vencimento desta parcela? A planilha e o compromisso das 13h30 às 14h30 no Google Calendar também serão atualizados.'
              : 'Deseja alterar a data de vencimento desta parcela?'
        }
        details={
          pendingConfirm
            ? [
                `Cliente: ${pendingConfirm.item.clientName}`,
                `Parcela: ${pendingConfirm.item.installmentNumber}/${pendingConfirm.item.totalInstallments}`,
                `Valor: ${formatCurrencyBRL(pendingConfirm.item.amount)}`,
                pendingConfirm.type === 'pay'
                  ? `Data de quitação: ${formatDateBR(todayISO)}`
                  : `Nova data de vencimento: ${formatDateBR(pendingConfirm.newDueDateISO ?? pendingConfirm.item.dueDate)} (13h30 às 14h30)`,
              ]
            : undefined
        }
        confirmLabel={
          pendingConfirm?.type === 'pay'
            ? 'Confirmar Pagamento'
            : 'Confirmar Nova Data'
        }
        onConfirm={executeConfirmedAction}
        onCancel={() => setPendingConfirm(null)}
      />

      {/* Mike Ross — Assistente Barreto (Gemini) */}
      <AssistantChatWidget
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
        messages={chatMessages}
        onMessagesChange={setChatMessages}
        clients={clients}
        calendarEvents={calendarEvents}
        todayISO={todayISO}
        appsScriptUrl={config.appsScriptUrl}
        contextExtras={assistantContextExtras}
        pendingDocumentRequest={pendingDocumentRequest}
        onClearPendingDocumentRequest={() => setPendingDocumentRequest(null)}
      />
    </div>
  );
}
