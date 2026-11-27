/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Menu, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  ActiveTab,
  AppsScriptCalendarEventRow,
  AppsScriptContractRow,
  AppsScriptDashboardSnapshot,
  AppsScriptDriveEtapaRow,
  AppsScriptPaymentRow,
  AppsScriptSyncResult,
  AppsScriptZapSignRefRow,
  ChatMessage,
  ClientCase,
  DriveArchitectureSummary,
  DriveFileItem,
  InstallmentWithStatus,
  SimulatorInputs,
  SimulatorPresetId,
  SyncConfig,
  WorkspaceArchitectureSnapshot,
  ZapSignCrossReferenceItem,
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
import {
  runPortfolioHealthCheck,
  type EnrichedAppsScriptSyncResult,
  type EnrichedClientCase,
  type PortfolioHealthReport,
  type RowParseIssue,
} from './utils/appsScriptMapper';
import { createDemoClients } from './data/demoData';
import {
  getFirebaseIdToken,
  getWorkspaceAccessToken,
  signInAppWithGoogle,
  signInWithGoogleWorkspace,
  signOutGoogleWorkspace,
  subscribeAppAuth,
} from './services/googleAuth';
import {
  DEFAULT_APPS_SCRIPT_URL,
  discoverBarretoWorkspace,
  executeAtomicClientRegistration,
  executeAtomicInstallmentPayment,
  executeAtomicRetryAction,
  getCachedAppsScriptSync,
  inspectAndFetchGoogleSheet,
  invalidateAppsScriptSyncCache,
  invalidateServerWorkspaceCache,
  postActionToAppsScript,
  syncCalendarBillingEvent,
  syncFromAppsScriptWithSWR,
  updateInstallmentInGoogleSheet,
  type AtomicRetryAction,
} from './services/googleWorkspace';
import { Sidebar } from './components/Sidebar';
import { BrandMark } from './components/BrandMark';
import { LoginView } from './components/LoginView';
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
import {
  ZapSignPrefilledClientDraft,
  ZapSignRegistrationModal,
} from './components/ZapSignRegistrationModal';

const STORAGE_CONFIG_KEY = 'barreto_honorarios_config_v1';
const STORAGE_DEMO_CLIENTS_KEY = 'barreto_honorarios_demo_clients_v1';
const STORAGE_GOALS_KEY = 'barreto_honorarios_goals_v1';
const STORAGE_SIMULATOR_KEY = 'barreto_honorarios_simulator_v1';
const STORAGE_ZAPSIGN_LINKS_KEY = 'barreto_honorarios_zapsign_links_v1';

// Aggressive SWR policy for the official Google Sheets SSOT ("Barreto — Honorários (Ads Família)")
const SSOT_SWR_FRESH_TTL_MS = 15_000; // 15s fresh window before background revalidation
const SSOT_SWR_MAX_STALE_MS = 24 * 60 * 60_000; // 24h instant stale-while-revalidate window
const SSOT_REVALIDATE_COOLDOWN_MS = 10_000; // Minimum 10s interval between focus/tab triggers

interface PendingConfirmAction {
  type: 'pay' | 'reschedule';
  item: InstallmentWithStatus;
  newDueDateISO?: string;
}

interface PendingAtomicRetryItem {
  id: string;
  clientName: string;
  action: AtomicRetryAction;
  lastError?: string;
}

export default function App() {
  const todayISO = useMemo(() => getTodayISO(), []);

  const initialBootstrap = useMemo(() => {
    let savedConfig: Partial<SyncConfig> | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (saved) {
        savedConfig = JSON.parse(saved) as Partial<SyncConfig>;
      }
    } catch {
      // ignore storage errors
    }

    const effectiveAppsScriptUrl =
      (savedConfig?.appsScriptUrl ?? '').trim() || DEFAULT_APPS_SCRIPT_URL;
    const cachedSwr = getCachedAppsScriptSync(effectiveAppsScriptUrl);
    const hasWarmSwr = Boolean(
      cachedSwr?.data?.clients && cachedSwr.data.clients.length > 0
    );

    const initialConfig: SyncConfig = {
      appsScriptUrl: effectiveAppsScriptUrl,
      spreadsheetId: savedConfig?.spreadsheetId ?? '',
      spreadsheetName:
        savedConfig?.spreadsheetName ?? 'Barreto — Honorários (Ads Família)',
      driveRootFolderName: 'Clientes Tráfego Pago',
      lastSyncedAt: hasWarmSwr && cachedSwr
        ? new Date(cachedSwr.cachedAt).toISOString()
        : null,
      sourceMode: hasWarmSwr ? 'apps_script' : 'demo',
      readOnlyMode: savedConfig?.readOnlyMode ?? true,
    };

    return {
      initialConfig,
      cachedSwr: hasWarmSwr ? cachedSwr : null,
    };
  }, []);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [config, setConfig] = useState<SyncConfig>(
    () => initialBootstrap.initialConfig
  );

  const [clients, setClients] = useState<EnrichedClientCase[]>(() => {
    if (initialBootstrap.cachedSwr?.data.clients.length) {
      return initialBootstrap.cachedSwr.data.clients;
    }
    try {
      const saved = localStorage.getItem(STORAGE_DEMO_CLIENTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as EnrichedClientCase[];
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
  >(() => initialBootstrap.cachedSwr?.data.summary ?? null);
  const [parseIssues, setParseIssues] = useState<RowParseIssue[]>(
    () => initialBootstrap.cachedSwr?.data.parseIssues ?? []
  );
  const [healthReport, setHealthReport] =
    useState<PortfolioHealthReport | null>(
      () => initialBootstrap.cachedSwr?.data.healthReport ?? null
    );
  const [isRevalidatingSWR, setIsRevalidatingSWR] = useState(false);
  const [pendingRetryActions, setPendingRetryActions] = useState<
    PendingAtomicRetryItem[]
  >([]);
  const [retryingActionId, setRetryingActionId] = useState<string | null>(null);
  const [cachedTabRowsByTitle, setCachedTabRowsByTitle] = useState<
    Record<string, unknown[][]>
  >({});
  const [cachedDriveSummary, setCachedDriveSummary] =
    useState<DriveArchitectureSummary | null>(null);

  const [authStatus, setAuthStatus] = useState<
    'checking' | 'unauthenticated' | 'unauthorized' | 'authorized'
  >('checking');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [rejectedEmail, setRejectedEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

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
  >(() => initialBootstrap.cachedSwr?.data.calendarEvents ?? []);
  const [driveEtapas, setDriveEtapas] = useState<AppsScriptDriveEtapaRow[]>(
    () => initialBootstrap.cachedSwr?.data.driveEtapas ?? []
  );
  const [officialDashboard, setOfficialDashboard] =
    useState<AppsScriptDashboardSnapshot | null>(
      () => initialBootstrap.cachedSwr?.data.officialDashboard ?? null
    );
  const [paymentsLedger, setPaymentsLedger] = useState<AppsScriptPaymentRow[]>(
    () => initialBootstrap.cachedSwr?.data.payments ?? []
  );
  const [contractsRef, setContractsRef] = useState<AppsScriptContractRow[]>(
    () => initialBootstrap.cachedSwr?.data.contracts ?? []
  );
  const [zapSignRefs, setZapSignRefs] = useState<AppsScriptZapSignRefRow[]>(
    () => initialBootstrap.cachedSwr?.data.zapSignRefs ?? []
  );
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const autoSyncTriggeredRef = useRef(false);
  const isMountedRef = useRef(true);
  const syncRequestSeqRef = useRef(0);
  const isSyncingRef = useRef(false);
  const isRevalidatingRef = useRef(false);
  const lastBackgroundRevalidateAtRef = useRef(0);
  const prevActiveTabRef = useRef<ActiveTab>('dashboard');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingDocumentRequest, setPendingDocumentRequest] =
    useState<PendingDocumentAnalysisRequest | null>(null);
  const [zapSignPrefillItem, setZapSignPrefillItem] =
    useState<ZapSignCrossReferenceItem | null>(null);
  const [manualZapSignLinks, setManualZapSignLinks] = useState<
    Record<string, string>
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_ZAPSIGN_LINKS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, string>;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return {};
  });

  const currentMonthKey = todayISO.slice(0, 7);
  const [dashboardSelectedMonthKey, setDashboardSelectedMonthKey] =
    useState<string>(currentMonthKey);
  const [clientsSessionContext, setClientsSessionContext] = useState<{
    search: string;
    stage: string;
    modality: string;
    focusedClientName: string | null;
  }>({
    search: '',
    stage: 'Todas',
    modality: 'Todas',
    focusedClientName: null,
  });

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
    try {
      localStorage.setItem(
        STORAGE_ZAPSIGN_LINKS_KEY,
        JSON.stringify(manualZapSignLinks)
      );
    } catch {
      // ignore storage errors
    }
  }, [manualZapSignLinks]);

  useEffect(() => {
    if (config.sourceMode === 'demo') {
      try {
        localStorage.setItem(STORAGE_DEMO_CLIENTS_KEY, JSON.stringify(clients));
      } catch {
        // ignore storage errors
      }
    }
  }, [clients, config.sourceMode]);

  const fetchZapSignSigned = useCallback(
    async (forceRefresh = false) => {
      if (authStatus !== 'authorized') return;
      const idToken = await getFirebaseIdToken();
      if (!idToken) return;

      setZapSignState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const res = await fetch(
          `/api/zapsign/signed${forceRefresh ? '?force=true' : ''}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );
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
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === 'authorized') {
      void fetchZapSignSigned();
    }
  }, [authStatus, fetchZapSignSigned]);

  useEffect(() => {
    const unsubscribe = subscribeAppAuth({
      onAuthorized: (user, workspaceToken) => {
        setAuthStatus('authorized');
        setRejectedEmail(null);
        setAuthError(null);
        setGoogleUserEmail(user.email ?? user.displayName ?? 'Conta Google');
        setGoogleConnected(Boolean(workspaceToken));
      },
      onUnauthorized: (rejected) => {
        setAuthStatus('unauthorized');
        setRejectedEmail(rejected || null);
        setAuthError(null);
        setGoogleUserEmail(null);
        setGoogleConnected(false);
      },
      onUnauthenticated: () => {
        setGoogleUserEmail(null);
        setGoogleConnected(false);
        setAuthStatus((prev) =>
          prev === 'unauthorized' ? 'unauthorized' : 'unauthenticated'
        );
      },
    });
    return () => unsubscribe();
  }, []);

  const showToast = useCallback((msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => {
      setActionFeedback((curr) => (curr === msg ? null : curr));
    }, 5000);
  }, []);

  const invalidateWorkspaceCaches = useCallback(
    async (appsScriptUrl?: string) => {
      const targetUrl =
        (appsScriptUrl ?? config.appsScriptUrl ?? '').trim() ||
        DEFAULT_APPS_SCRIPT_URL;
      const idToken = await getFirebaseIdToken().catch(() => null);
      await invalidateServerWorkspaceCache(idToken, targetUrl);
    },
    [config.appsScriptUrl]
  );

  const enqueueAtomicRetryActions = useCallback(
    (clientName: string, retryActions: AtomicRetryAction[]) => {
      if (retryActions.length === 0) return;
      const stamped = Date.now();
      setPendingRetryActions((prev) => [
        ...retryActions.map((action, idx) => ({
          id: `retry-${stamped}-${idx}-${action.step}`,
          clientName,
          action,
        })),
        ...prev,
      ]);
    },
    []
  );

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

      const wsHealthReport = runPortfolioHealthCheck(
        sheetResult.clients,
        [],
        []
      );
      const enrichedClients: EnrichedClientCase[] = sheetResult.clients.map(
        (c) => ({
          ...c,
          syncWarnings: wsHealthReport.warningsByClientId[c.id] ?? [],
          healthCheck: wsHealthReport.healthByClientId[c.id],
        })
      );

      setClients(enrichedClients);
      setOfficialDashboard(null);
      setPaymentsLedger([]);
      setContractsRef([]);
      setZapSignRefs([]);
      setParseIssues(wsHealthReport.parseIssues);
      setHealthReport(wsHealthReport);
      setConfig((prev) => ({
        ...prev,
        spreadsheetId: targetSpreadsheetId,
        spreadsheetName: sheetResult.spreadsheetTitle,
        lastSyncedAt: new Date().toISOString(),
        sourceMode: 'google_workspace',
      }));
      setSyncMessage({
        type: 'success',
        text: `Leitura concluída: ${sheetResult.clients.length} clientes e ${parsedInstallmentsCount} parcelas carregadas da aba "${sheetResult.activeTabTitle}".`,
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
      const tabHealthReport = runPortfolioHealthCheck(parsedClients, [], []);
      const enrichedTabClients: EnrichedClientCase[] = parsedClients.map(
        (c) => ({
          ...c,
          syncWarnings: tabHealthReport.warningsByClientId[c.id] ?? [],
          healthCheck: tabHealthReport.healthByClientId[c.id],
        })
      );
      setClients(enrichedTabClients);
      setParseIssues(tabHealthReport.parseIssues);
      setHealthReport(tabHealthReport);
      setConfig((prev) => ({
        ...prev,
        sourceMode: 'google_workspace',
        lastSyncedAt: new Date().toISOString(),
      }));
      setSyncMessage({
        type: 'success',
        text: `Aba "${tabTitle}" carregada no painel (${parsedClients.length} clientes, ${parsedInstallmentsCount} parcelas).`,
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

  const handleAppSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const res = await signInAppWithGoogle();
      if (!res.authorized) {
        setAuthStatus('unauthorized');
        setRejectedEmail(res.rejectedEmail || null);
        setGoogleUserEmail(null);
        setGoogleConnected(false);
        return;
      }
      setAuthStatus('authorized');
      setRejectedEmail(null);
      setAuthError(null);
      setGoogleUserEmail(
        res.user.email ?? res.user.displayName ?? 'Conta Google'
      );
      setGoogleConnected(Boolean(res.accessToken));
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        setAuthError('Login cancelado antes da conclusão.');
      } else {
        setAuthError(
          err instanceof Error
            ? err.message
            : 'Não foi possível concluir o login com o Google.'
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogleWorkspace();
    setAuthStatus('unauthenticated');
    setRejectedEmail(null);
    setAuthError(null);
    setGoogleUserEmail(null);
    setGoogleConnected(false);
    setChatOpen(false);
    setChatMessages([]);
    setMobileMenuOpen(false);
    setZapSignState({
      configured: false,
      loading: false,
      docs: [],
      error: null,
      lastFetchedAt: null,
    });
    autoSyncTriggeredRef.current = false;
    syncRequestSeqRef.current += 1;
    isSyncingRef.current = false;
    isRevalidatingRef.current = false;
    lastBackgroundRevalidateAtRef.current = 0;
    invalidateAppsScriptSyncCache();
    setIsAutoSyncing(false);
    setAutoSyncError(null);
    setDriveEtapas([]);
    setCalendarEvents([]);
    setOfficialDashboard(null);
    setPaymentsLedger([]);
    setContractsRef([]);
    setZapSignRefs([]);
    setAppsScriptSummary(null);
    setParseIssues([]);
    setHealthReport(null);
    setIsRevalidatingSWR(false);
    setPendingRetryActions([]);
    setArchitectureSnapshot(null);
    setCachedTabRowsByTitle({});
    setCachedDriveSummary(null);
    setConfig((prev) => ({ ...prev, sourceMode: 'demo', lastSyncedAt: null }));
    setClients(createDemoClients(todayISO));
    setSyncMessage({
      type: 'success',
      text: 'Sessão encerrada.',
    });
  };

  const applyAppsScriptSyncResult = useCallback(
    (
      result: EnrichedAppsScriptSyncResult,
      effectiveUrl: string,
      meta?: { fromCache?: boolean; isStale?: boolean; isBackground?: boolean }
    ) => {
      if (result.clients.length === 0) {
        const emptyMsg =
          'O Web App respondeu, mas não retornou registros de clientes.';
        setAutoSyncError(emptyMsg);
        setSyncMessage({
          type: 'error',
          text: emptyMsg,
        });
        return false;
      }
      setClients(result.clients);
      setCalendarEvents(result.calendarEvents);
      setDriveEtapas(result.driveEtapas);
      setOfficialDashboard(result.officialDashboard ?? null);
      setPaymentsLedger(result.payments ?? []);
      setContractsRef(result.contracts ?? []);
      setZapSignRefs(result.zapSignRefs ?? []);
      setAppsScriptSummary(result.summary);
      setParseIssues(result.parseIssues ?? []);
      setHealthReport(result.healthReport ?? null);
      setAutoSyncError(null);
      setConfig((prev) => ({
        ...prev,
        appsScriptUrl: effectiveUrl,
        lastSyncedAt: new Date().toISOString(),
        sourceMode: 'apps_script',
      }));

      const integritySuffix =
        result.parseIssues.length > 0 ||
        (result.healthReport?.clientsWithWarningsCount ?? 0) > 0
          ? ` · Auditoria: ${result.healthReport?.clientsWithWarningsCount ?? 0} alerta(s) e ${result.parseIssues.length} célula(s) isolada(s).`
          : '';
      const modeLabel = meta?.isStale
        ? 'Cache SWR exibido (revalidando em segundo plano)'
        : meta?.fromCache
          ? 'Cache SWR atualizado'
          : meta?.isBackground
            ? 'Carteira revalidada em segundo plano'
            : 'Planilha oficial sincronizada (SSOT)';

      setSyncMessage({
        type: 'success',
        text: `${modeLabel}: ${result.summary.clientesCount} clientes, ${result.summary.parcelasCount} parcelas, ${result.summary.matchedDriveCount} pastas do Drive (${result.summary.driveFilesCount} arquivos) e ${result.summary.eventosAgendaCount} eventos na agenda${integritySuffix}`,
      });
      return true;
    },
    []
  );

  const handleSyncAppsScript = useCallback(
    async (
      url?: string,
      options?: { forceRefresh?: boolean; background?: boolean }
    ) => {
      const effectiveUrl = (url ?? '').trim() || DEFAULT_APPS_SCRIPT_URL;
      const forceRefresh = options?.forceRefresh ?? false;
      const isBackground = options?.background ?? false;
      const requestSeq = ++syncRequestSeqRef.current;

      if (isBackground) {
        isRevalidatingRef.current = true;
        setIsRevalidatingSWR(true);
      } else {
        isSyncingRef.current = true;
        setIsSyncing(true);
        setSyncMessage(null);
        setAutoSyncError(null);
      }

      try {
        const swrResult = await syncFromAppsScriptWithSWR(effectiveUrl, {
          forceRefresh,
          freshTtlMs: SSOT_SWR_FRESH_TTL_MS,
          maxStaleMs: SSOT_SWR_MAX_STALE_MS,
          onRevalidated: (fresh) => {
            if (!isMountedRef.current || requestSeq !== syncRequestSeqRef.current) {
              return;
            }
            isRevalidatingRef.current = false;
            setIsRevalidatingSWR(false);
            lastBackgroundRevalidateAtRef.current = Date.now();
            applyAppsScriptSyncResult(fresh, effectiveUrl, {
              isBackground: true,
            });
          },
          onRevalidationError: () => {
            if (!isMountedRef.current || requestSeq !== syncRequestSeqRef.current) {
              return;
            }
            isRevalidatingRef.current = false;
            setIsRevalidatingSWR(false);
          },
        });

        // Prevent unhandled promise rejection if background revalidation fails on a stale hit
        swrResult.backgroundRevalidation?.catch(() => {});

        if (!isMountedRef.current || requestSeq !== syncRequestSeqRef.current) {
          return;
        }

        isRevalidatingRef.current = swrResult.revalidating;
        setIsRevalidatingSWR(swrResult.revalidating);
        if (!swrResult.revalidating) {
          lastBackgroundRevalidateAtRef.current = Date.now();
        }

        // Apply mapped snapshot immediately (0ms wait on cache hit / stale hit)
        if (!isBackground || !swrResult.fromCache || swrResult.isStale) {
          applyAppsScriptSyncResult(swrResult.data, effectiveUrl, {
            fromCache: swrResult.fromCache,
            isStale: swrResult.isStale,
            isBackground: isBackground && !swrResult.fromCache,
          });
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        isRevalidatingRef.current = false;
        setIsRevalidatingSWR(false);
        if (!isBackground) {
          const errorText =
            err instanceof Error && err.message
              ? err.message
              : 'Não foi possível conectar à URL do Google Apps Script informada.';
          setAutoSyncError(errorText);
          setSyncMessage({
            type: 'error',
            text: errorText,
          });
        }
      } finally {
        if (isMountedRef.current) {
          if (isBackground) {
            if (!isRevalidatingRef.current) {
              setIsRevalidatingSWR(false);
            }
          } else {
            isSyncingRef.current = false;
            setIsSyncing(false);
          }
        }
      }
    },
    [applyAppsScriptSyncResult]
  );

  const triggerBackgroundSsotRevalidation = useCallback(() => {
    if (authStatus !== 'authorized') return;
    if (config.sourceMode === 'google_workspace') return;
    if (isSyncingRef.current || isRevalidatingRef.current) return;

    const now = Date.now();
    if (now - lastBackgroundRevalidateAtRef.current < SSOT_REVALIDATE_COOLDOWN_MS) {
      return;
    }

    const effectiveUrl =
      (config.appsScriptUrl ?? '').trim() || DEFAULT_APPS_SCRIPT_URL;
    const cached = getCachedAppsScriptSync(effectiveUrl);
    if (cached && now <= cached.freshUntil) {
      return;
    }

    lastBackgroundRevalidateAtRef.current = now;
    void handleSyncAppsScript(effectiveUrl, {
      forceRefresh: false,
      background: true,
    });
  }, [authStatus, config.appsScriptUrl, config.sourceMode, handleSyncAppsScript]);

  const handleRefreshPortfolio = useCallback(async () => {
    if (config.sourceMode === 'google_workspace' && googleConnected) {
      await handleSyncGoogleWorkspace(config.spreadsheetId || undefined);
      return;
    }
    await handleSyncAppsScript(
      config.appsScriptUrl || DEFAULT_APPS_SCRIPT_URL,
      { forceRefresh: true }
    );
  }, [
    config.appsScriptUrl,
    config.sourceMode,
    config.spreadsheetId,
    googleConnected,
    handleSyncAppsScript,
  ]);

  // Initial aggressive SWR load upon authorization (instant when warm cache exists)
  useEffect(() => {
    if (authStatus === 'authorized' && !autoSyncTriggeredRef.current) {
      autoSyncTriggeredRef.current = true;
      const effectiveUrl =
        (config.appsScriptUrl ?? '').trim() || DEFAULT_APPS_SCRIPT_URL;
      const hasWarmCache = Boolean(
        getCachedAppsScriptSync(effectiveUrl)?.data?.clients?.length
      );
      if (hasWarmCache) {
        // Warm cache already hydrated state synchronously -> silently revalidate in background
        void handleSyncAppsScript(effectiveUrl, {
          forceRefresh: false,
          background: true,
        });
      } else {
        setIsAutoSyncing(true);
        void handleSyncAppsScript(effectiveUrl, {
          forceRefresh: false,
          background: false,
        }).finally(() => {
          setIsAutoSyncing(false);
        });
      }
    }
  }, [authStatus, config.appsScriptUrl, handleSyncAppsScript]);

  // Agile SWR revalidation when returning to window or browser tab
  useEffect(() => {
    if (authStatus !== 'authorized') return;
    const onFocus = () => {
      triggerBackgroundSsotRevalidation();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerBackgroundSsotRevalidation();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [authStatus, triggerBackgroundSsotRevalidation]);

  // Agile SWR revalidation when navigating back to the Dashboard tab
  useEffect(() => {
    const previousTab = prevActiveTabRef.current;
    prevActiveTabRef.current = activeTab;
    if (previousTab !== 'dashboard' && activeTab === 'dashboard') {
      triggerBackgroundSsotRevalidation();
    }
  }, [activeTab, triggerBackgroundSsotRevalidation]);

  const handleResetDemo = () => {
    const fresh = createDemoClients(todayISO);
    setClients(fresh);
    setCalendarEvents([]);
    setDriveEtapas([]);
    setOfficialDashboard(null);
    setPaymentsLedger([]);
    setContractsRef([]);
    setZapSignRefs([]);
    setAppsScriptSummary(null);
    setParseIssues([]);
    setHealthReport(null);
    setIsRevalidatingSWR(false);
    setPendingRetryActions([]);
    setAutoSyncError(null);
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
    const targetClient = clients.find((c) => c.id === item.clientId);

    try {
      const accessToken = getWorkspaceAccessToken();
      let atomicPaymentHandled = false;
      let atomicPaymentToast: string | null = null;
      let updatedDriveFolderUrl: string | undefined;
      let updatedCalendarEventId: string | undefined;

      if (!config.readOnlyMode) {
        if (
          type === 'pay' &&
          accessToken &&
          config.spreadsheetId &&
          targetClient &&
          item.sheetRowNumber
        ) {
          const txResult = await executeAtomicInstallmentPayment({
            accessToken,
            spreadsheetId: config.spreadsheetId,
            sheetTabTitle,
            client: targetClient,
            installment: item,
            paidDateISO: todayISO,
            parentDriveFolderId: cachedDriveSummary?.rootFolderId ?? undefined,
            readOnlyMode: config.readOnlyMode,
            appsScriptUrlToInvalidate: config.appsScriptUrl,
          });

          if (!txResult.ssotCommitted) {
            showToast(
              txResult.warnings[0] ??
                'Não foi possível gravar a baixa na planilha oficial (SSOT).'
            );
            return;
          }

          atomicPaymentHandled = true;
          updatedDriveFolderUrl = txResult.data?.driveFolderUrl;
          updatedCalendarEventId = txResult.data?.calendarEventId;
          void invalidateWorkspaceCaches(config.appsScriptUrl);

          if (txResult.partialFailure && txResult.retryActions.length > 0) {
            enqueueAtomicRetryActions(
              targetClient.fullName,
              txResult.retryActions
            );
            atomicPaymentToast = `Baixa de ${item.clientName} (${item.installmentNumber}/${item.totalInstallments}) gravada na Planilha (SSOT). Pendência operacional no Calendar/Drive disponível para reexecução rápida.`;
          } else {
            atomicPaymentToast = `Parcela ${item.installmentNumber}/${item.totalInstallments} de ${item.clientName} quitada na Planilha (SSOT), Calendar atualizado e pasta no Drive confirmada.`;
          }
        } else if (
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
            void invalidateWorkspaceCaches(config.appsScriptUrl);
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
            void invalidateWorkspaceCaches(config.appsScriptUrl);
          }
        } else if (
          config.sourceMode === 'apps_script' &&
          config.appsScriptUrl
        ) {
          await postActionToAppsScript(
            config.appsScriptUrl,
            {
              action: type === 'pay' ? 'mark_paid' : 'reschedule',
              installmentId: item.id,
              clientId: item.clientId,
              paidDate: type === 'pay' ? todayISO : undefined,
              newDueDate: newDueDateISO,
            },
            config.readOnlyMode
          );
          void invalidateWorkspaceCaches(config.appsScriptUrl);
        }
      }

      if (type === 'pay') {
        setClients((prev) => {
          const paidClients = markInstallmentPaid(
            prev,
            item.id,
            todayISO
          ) as EnrichedClientCase[];
          if (!updatedDriveFolderUrl && !updatedCalendarEventId) {
            return paidClients;
          }
          return paidClients.map((c) => {
            if (c.id !== item.clientId) return c;
            return {
              ...c,
              driveFolderUrl: updatedDriveFolderUrl || c.driveFolderUrl,
              installments: updatedCalendarEventId
                ? c.installments.map((inst) =>
                    inst.id === item.id
                      ? { ...inst, calendarEventId: updatedCalendarEventId }
                      : inst
                  )
                : c.installments,
            };
          });
        });

        showToast(
          atomicPaymentHandled && atomicPaymentToast
            ? atomicPaymentToast
            : config.readOnlyMode && config.sourceMode !== 'demo'
              ? `Parcela ${item.installmentNumber}/${item.totalInstallments} de ${item.clientName} marcada como paga no painel (planilha oficial intacta).`
              : `Parcela ${item.installmentNumber}/${item.totalInstallments} de ${item.clientName} marcada como paga.`
        );
      } else if (type === 'reschedule' && newDueDateISO) {
        setClients((prev) =>
          rescheduleInstallment(
            prev,
            item.id,
            newDueDateISO
          ) as EnrichedClientCase[]
        );
        showToast(
          config.readOnlyMode && config.sourceMode !== 'demo'
            ? `Vencimento de ${item.clientName} alterado para ${formatDateBR(newDueDateISO)} no painel (planilha oficial intacta).`
            : `Vencimento de ${item.clientName} alterado para ${formatDateBR(newDueDateISO)}.`
        );
      }
    } catch (err: unknown) {
      showToast(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível concluir a atualização nos serviços Google.'
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

  const zapSignMatchResult = useMemo(() => {
    const base = matchZapSignToClients(
      clients,
      zapSignState.docs,
      driveEtapas,
      calendarEvents,
      {
        contracts: contractsRef,
        zapSignRefs,
      }
    );

    const hasManualLinks = Object.keys(manualZapSignLinks).length > 0;
    if (!hasManualLinks) return base;

    const clientById = new Map(clients.map((c) => [c.id, c]));
    const matchedByClientId: Record<string, ZapSignSignedDoc[]> = {
      ...base.matchedByClientId,
    };
    const remainingAuditItems: ZapSignCrossReferenceItem[] = [];
    const remainingDocs: ZapSignSignedDoc[] = [];

    for (const item of base.unmatchedAuditItems) {
      const linkedClientId = manualZapSignLinks[item.doc.token];
      const linkedClient = linkedClientId
        ? clientById.get(linkedClientId)
        : undefined;
      if (linkedClient) {
        const list = matchedByClientId[linkedClient.id]
          ? [...matchedByClientId[linkedClient.id]]
          : [];
        if (!list.some((d) => d.token === item.doc.token)) {
          list.push(item.doc);
        }
        matchedByClientId[linkedClient.id] = list;
      } else {
        remainingAuditItems.push(item);
        remainingDocs.push(item.doc);
      }
    }

    return {
      ...base,
      matchedByClientId,
      unmatchedAuditItems: remainingAuditItems,
      unmatchedDocs: remainingDocs,
    };
  }, [
    clients,
    zapSignState.docs,
    driveEtapas,
    calendarEvents,
    contractsRef,
    zapSignRefs,
    manualZapSignLinks,
  ]);

  const handleCreateClientFromZapSign = async (
    draft: ZapSignPrefilledClientDraft
  ) => {
    const newId = `zapsign-cli-${Date.now()}`;
    const newClient: EnrichedClientCase = {
      id: newId,
      fullName: draft.fullName,
      cpf: draft.cpf,
      phone: draft.phone,
      caseType: draft.caseType,
      driveStage: draft.driveStage,
      driveFolderUrl: draft.driveFolderUrl,
      modality: draft.modality,
      contractedTotal: draft.contractedTotal,
      notes: `Pré-cadastrado via ZapSign (assinado em ${draft.signedAt.slice(0, 10)})`,
      installments: [],
    };

    const accessToken = getWorkspaceAccessToken();

    if (!config.readOnlyMode && accessToken && config.spreadsheetId) {
      setIsSavingAction(true);
      try {
        const txResult = await executeAtomicClientRegistration({
          accessToken,
          spreadsheetId: config.spreadsheetId,
          sheetTabTitle,
          client: newClient,
          parentDriveFolderId: cachedDriveSummary?.rootFolderId ?? undefined,
          readOnlyMode: config.readOnlyMode,
          appsScriptUrlToInvalidate: config.appsScriptUrl,
        });

        if (!txResult.ssotCommitted) {
          showToast(
            txResult.warnings[0] ??
              'Não foi possível gravar o novo cliente na planilha oficial (SSOT).'
          );
          return;
        }

        void invalidateWorkspaceCaches(config.appsScriptUrl);
        const persistedClient: EnrichedClientCase = {
          ...newClient,
          driveFolderUrl:
            txResult.data?.driveFolderUrl || newClient.driveFolderUrl,
        };
        setClients((prev) => [persistedClient, ...prev]);
        setManualZapSignLinks((prev) => ({ ...prev, [draft.docToken]: newId }));
        setZapSignPrefillItem(null);

        if (txResult.partialFailure && txResult.retryActions.length > 0) {
          enqueueAtomicRetryActions(draft.fullName, txResult.retryActions);
          showToast(
            `Cliente "${draft.fullName}" gravado na Planilha (SSOT). Pendência operacional no Calendar/Drive disponível para reexecução rápida.`
          );
        } else {
          showToast(
            `Cliente "${draft.fullName}" gravado na Planilha (SSOT), Calendar e Drive com sucesso.`
          );
        }
      } finally {
        setIsSavingAction(false);
      }
      return;
    }

    if (
      !config.readOnlyMode &&
      config.sourceMode === 'apps_script' &&
      config.appsScriptUrl
    ) {
      setIsSavingAction(true);
      try {
        await postActionToAppsScript(
          config.appsScriptUrl,
          {
            action: 'create_client',
            client: newClient,
          },
          config.readOnlyMode
        );
        void invalidateWorkspaceCaches(config.appsScriptUrl);
      } catch (err: unknown) {
        showToast(
          err instanceof Error && err.message
            ? err.message
            : 'Não foi possível enviar o novo cliente para o Apps Script.'
        );
        return;
      } finally {
        setIsSavingAction(false);
      }
    }

    setClients((prev) => [newClient, ...prev]);
    setManualZapSignLinks((prev) => ({ ...prev, [draft.docToken]: newId }));
    setZapSignPrefillItem(null);
    showToast(
      config.readOnlyMode && config.sourceMode !== 'demo'
        ? `Cliente "${draft.fullName}" pré-cadastrado na sessão do painel (planilha oficial intacta).`
        : `Cliente "${draft.fullName}" adicionado ao painel a partir do ZapSign.`
    );
  };

  const handleRetryAtomicAction = async (retryId: string) => {
    const target = pendingRetryActions.find((item) => item.id === retryId);
    if (!target) return;

    const accessToken = getWorkspaceAccessToken();
    if (!accessToken) {
      showToast(
        'Conecte sua conta Google Workspace em Configurações para reexecutar Calendar/Drive.'
      );
      return;
    }

    setRetryingActionId(retryId);
    try {
      const result = await executeAtomicRetryAction(accessToken, target.action);
      if (!result.ok) {
        setPendingRetryActions((prev) =>
          prev.map((item) =>
            item.id === retryId
              ? { ...item, lastError: result.error }
              : item
          )
        );
        showToast(
          result.error ?? 'Falha ao reexecutar a ação operacional pendente.'
        );
        return;
      }

      const clientId = String(target.action.payload.clientId ?? '');
      const installmentId = String(target.action.payload.installmentId ?? '');
      if (clientId && (result.driveFolderUrl || result.calendarEventId)) {
        setClients((prev) =>
          prev.map((c) => {
            if (c.id !== clientId) return c;
            return {
              ...c,
              driveFolderUrl: result.driveFolderUrl || c.driveFolderUrl,
              installments:
                result.calendarEventId && installmentId
                  ? c.installments.map((inst) =>
                      inst.id === installmentId
                        ? { ...inst, calendarEventId: result.calendarEventId }
                        : inst
                    )
                  : c.installments,
            };
          })
        );
      }

      setPendingRetryActions((prev) => prev.filter((item) => item.id !== retryId));
      void invalidateWorkspaceCaches(config.appsScriptUrl);
      showToast(`Ação concluída com sucesso: ${target.action.description}.`);
    } finally {
      setRetryingActionId(null);
    }
  };

  const handleRetryAllAtomicActions = async () => {
    for (const item of [...pendingRetryActions]) {
      await handleRetryAtomicAction(item.id);
    }
  };

  const handleLinkZapSignToExistingClient = (
    docToken: string,
    clientId: string
  ) => {
    const target = clients.find((c) => c.id === clientId);
    setManualZapSignLinks((prev) => ({ ...prev, [docToken]: clientId }));
    setZapSignPrefillItem(null);
    showToast(
      target
        ? `Contrato ZapSign vinculado a "${target.fullName}" na auditoria.`
        : 'Contrato ZapSign vinculado à cliente selecionada.'
    );
  };

  const focusedInstallmentItem =
    whatsAppItem ?? rescheduleItem ?? pendingConfirm?.item ?? null;

  const assistantContextExtras: AssistantContextExtras = useMemo(
    () => ({
      activeTab,
      selectedMonthKey:
        activeTab === 'dashboard' ? dashboardSelectedMonthKey : currentMonthKey,
      sourceMode: config.sourceMode,
      readOnlyMode: config.readOnlyMode,
      activeFilters:
        activeTab === 'clientes'
          ? {
              search: clientsSessionContext.search,
              stage: clientsSessionContext.stage,
              modality: clientsSessionContext.modality,
            }
          : undefined,
      focusedClientName:
        activeTab === 'clientes'
          ? clientsSessionContext.focusedClientName
          : null,
      focusedInstallment: focusedInstallmentItem
        ? {
            clientName: focusedInstallmentItem.clientName,
            installmentNumber: focusedInstallmentItem.installmentNumber,
            totalInstallments: focusedInstallmentItem.totalInstallments,
            amount: focusedInstallmentItem.amount,
            dueDate: focusedInstallmentItem.dueDate,
            status: focusedInstallmentItem.status,
          }
        : null,
      goalsByMonth,
      defaultGoal: DEFAULT_MONTHLY_GOAL,
      simulatorInputs,
      simulatorOutputs,
      zapSignDocs: zapSignState.docs,
      unmatchedZapSignDocs: zapSignMatchResult.unmatchedDocs,
      unmatchedZapSignItems: zapSignMatchResult.unmatchedAuditItems,
      officialDashboard,
      payments: paymentsLedger,
    }),
    [
      activeTab,
      dashboardSelectedMonthKey,
      currentMonthKey,
      config.sourceMode,
      config.readOnlyMode,
      clientsSessionContext,
      focusedInstallmentItem,
      goalsByMonth,
      simulatorInputs,
      simulatorOutputs,
      zapSignState.docs,
      zapSignMatchResult.unmatchedDocs,
      zapSignMatchResult.unmatchedAuditItems,
      officialDashboard,
      paymentsLedger,
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

  if (authStatus !== 'authorized') {
    return (
      <LoginView
        status={authStatus}
        isSigningIn={isSigningIn}
        rejectedEmail={rejectedEmail}
        errorMessage={authError}
        onSignInWithGoogle={handleAppSignIn}
      />
    );
  }

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

        {/* Atomic Transaction Pending Retry Actions Banner (Sheets SSOT succeeded, Calendar/Drive failed) */}
        {pendingRetryActions.length > 0 && (
          <div
            role="alert"
            data-testid="atomic-retry-actions-banner"
            className="mx-4 mt-3 sm:mx-8 lg:mx-10 rounded-xl border border-[#DCB14A] bg-white px-4 py-3 text-xs text-[#313131] shadow-sm space-y-2.5"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8D6A14]" />
                <div>
                  <p className="font-semibold text-[#313131]">
                    Planilha atualizada (SSOT) · {pendingRetryActions.length}{' '}
                    {pendingRetryActions.length === 1
                      ? 'ação operacional pendente'
                      : 'ações operacionais pendentes'}
                  </p>
                  <p className="mt-0.5 text-[#313131]/70">
                    O registro financeiro foi salvo com segurança na planilha. Reexecute os reflexos pendentes no Calendar/Drive abaixo:
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {pendingRetryActions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void handleRetryAllAtomicActions()}
                    disabled={Boolean(retryingActionId)}
                    data-testid="atomic-retry-all-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#313131] px-3 py-1.5 text-[11px] font-medium text-[#FFD559] hover:bg-[#313131]/90 disabled:opacity-50 whitespace-nowrap"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reexecutar todas
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPendingRetryActions([])}
                  aria-label="Dispensar avisos de reexecução"
                  className="rounded-md p-1 text-[#313131]/55 hover:bg-[#F6F3EC] hover:text-[#313131]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <ul className="divide-y divide-[#313131]/10 rounded-lg border border-[#313131]/10 bg-[#F6F3EC]/60">
              {pendingRetryActions.map((entry) => {
                const isRunning = retryingActionId === entry.id;
                return (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded border border-[#DCB14A]/60 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8D6A14]">
                          {entry.action.step === 'calendar'
                            ? 'Calendar'
                            : 'Drive'}
                        </span>
                        <span className="font-medium text-[#313131]">
                          {entry.action.description}
                        </span>
                      </div>
                      {entry.lastError && (
                        <p className="mt-0.5 text-[11px] text-red-800">
                          Última tentativa: {entry.lastError}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleRetryAtomicAction(entry.id)}
                        disabled={Boolean(retryingActionId)}
                        data-testid={`atomic-retry-btn-${entry.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-[#313131] px-2.5 py-1 text-[11px] font-medium text-[#FFD559] hover:bg-[#313131]/90 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RotateCcw
                          className={`h-3 w-3 ${isRunning ? 'animate-spin' : ''}`}
                        />
                        {isRunning ? 'Reexecutando...' : 'Reexecutar'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingRetryActions((prev) =>
                            prev.filter((p) => p.id !== entry.id)
                          )
                        }
                        className="rounded-md border border-[#313131]/18 bg-white px-2 py-1 text-[11px] text-[#313131]/70 hover:text-[#313131]"
                      >
                        Dispensar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <main className="flex-1 px-4 pt-6 pb-24 sm:px-8 sm:pt-8 lg:px-10 lg:pt-10 max-w-[1400px] w-full mx-auto">
          {/* Initial Automatic Sync Status / Error Banner */}
          {isAutoSyncing && config.sourceMode !== 'apps_script' && (
            <div
              role="status"
              data-testid="auto-sync-loading-banner"
              className="mb-6 flex items-center gap-3 rounded-xl border border-[#DCB14A]/60 bg-white px-4 py-3 text-xs text-[#313131]"
            >
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-[#8D6A14]" />
              <span>
                Sincronizando planilha oficial e Google Drive em modo{' '}
                <strong className="font-semibold">Somente Leitura</strong>...
              </span>
            </div>
          )}

          {!isAutoSyncing &&
            autoSyncError &&
            config.sourceMode !== 'apps_script' && (
              <div
                role="alert"
                data-testid="auto-sync-error-banner"
                className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-red-700/30 bg-red-50 px-4 py-3 text-xs text-red-950"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  <div>
                    <p className="font-semibold">
                      Não foi possível carregar a planilha oficial automaticamente.
                    </p>
                    <p className="mt-0.5 text-red-900/85">{autoSyncError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoSyncing(true);
                    void handleSyncAppsScript(
                      config.appsScriptUrl || DEFAULT_APPS_SCRIPT_URL
                    ).finally(() => setIsAutoSyncing(false));
                  }}
                  disabled={isSyncing}
                  data-testid="retry-apps-script-sync-btn"
                  className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-lg bg-[#313131] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#313131]/90 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-[#FFD559] ${
                      isSyncing ? 'animate-spin' : ''
                    }`}
                  />
                  Tentar sincronizar novamente
                </button>
              </div>
            )}

          {activeTab === 'dashboard' && (
            <DashboardView
              clients={clients}
              todayISO={todayISO}
              officialDashboard={officialDashboard}
              payments={paymentsLedger}
              unmatchedZapSignDocs={zapSignMatchResult.unmatchedDocs}
              unmatchedZapSignItems={zapSignMatchResult.unmatchedAuditItems}
              proceduralZapSignCount={
                zapSignMatchResult.proceduralAuditItems.length
              }
              zapSignSignedCount={zapSignState.docs.length}
              healthReport={healthReport}
              parseIssues={parseIssues}
              isSyncing={isSyncing}
              isRevalidatingSWR={isRevalidatingSWR}
              onRefreshPortfolio={handleRefreshPortfolio}
              onMarkPaid={requestMarkPaid}
              onOpenWhatsApp={setWhatsAppItem}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onSelectedMonthChange={setDashboardSelectedMonthKey}
              onPrefillZapSignItem={setZapSignPrefillItem}
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
              unmatchedZapSignItems={zapSignMatchResult.unmatchedAuditItems}
              proceduralZapSignCount={
                zapSignMatchResult.proceduralAuditItems.length
              }
              healthReport={healthReport}
              parseIssues={parseIssues}
              onRefreshZapSign={() => void fetchZapSignSigned(true)}
              onPrefillZapSignItem={setZapSignPrefillItem}
              onQuitarParcela={requestMarkPaid}
              onAlterarData={setRescheduleItem}
              onAnalyzeDocument={handleAnalyzeDocument}
              onSessionContextChange={setClientsSessionContext}
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
              onSyncAppsScript={(url) =>
                handleSyncAppsScript(url, { forceRefresh: true })
              }
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

      {/* ZapSign Pre-fill & Linking Modal */}
      <ZapSignRegistrationModal
        item={zapSignPrefillItem}
        existingClients={clients}
        readOnlyMode={config.readOnlyMode && config.sourceMode !== 'demo'}
        onCreateClientFromZapSign={handleCreateClientFromZapSign}
        onLinkToExistingClient={handleLinkZapSignToExistingClient}
        onClose={() => setZapSignPrefillItem(null)}
      />

      {/* Dona — Assistente Operacional e Financeira do Barreto Flow (Gemini) */}
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
