export type DriveStage =
  | '01- Etapa Luis'
  | '02- Etapa Carlos'
  | '03- Etapa Gilmar'
  | '04- Emendas'
  | 'Protocolados / Processo Ativo';

export const DRIVE_STAGES: DriveStage[] = [
  '01- Etapa Luis',
  '02- Etapa Carlos',
  '03- Etapa Gilmar',
  '04- Emendas',
  'Protocolados / Processo Ativo',
];

export type PaymentModality = 'Parcelado' | 'À vista' | 'Êxito 30%';

export const PAYMENT_MODALITIES: PaymentModality[] = [
  'Parcelado',
  'À vista',
  'Êxito 30%',
];

export type InstallmentStatus = 'Em dia' | 'Atrasada' | 'Paga';

export interface Installment {
  id: string;
  clientId: string;
  clientName: string;
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  paidDate?: string; // YYYY-MM-DD
  calendarEventId?: string;
  sheetRowNumber?: number;
}

export interface DriveFileItem {
  id: string;
  nome: string;
  mimeType: string;
  url: string;
  atualizadoEm?: string;
}

export interface ClientCase {
  id: string;
  fullName: string;
  phone: string;
  caseType: string;
  processNumber?: string;
  driveStage: DriveStage;
  driveFolderUrl: string;
  driveFiles?: DriveFileItem[];
  modality: PaymentModality;
  contractedTotal: number;
  notes?: string;
  installments: Installment[];
}

export interface InstallmentWithStatus extends Installment {
  status: InstallmentStatus;
  clientPhone: string;
  caseType: string;
  driveStage: DriveStage;
  modality: PaymentModality;
}

export interface DashboardKPIs {
  totalAReceber: number;
  recebidoNoMes: number;
  previstoNoMes: number;
  parcelasEmAtrasoCount: number;
  parcelasEmAtrasoValor: number;
  vencimentosSemanaCount: number;
  vencimentosSemanaValor: number;
  ticketMedioCarteira: number;
  taxaAdimplencia: number;
  selectedMonthKey: string;
}

export interface MonthlyChartPoint {
  monthKey: string; // YYYY-MM
  label: string; // e.g., "Nov/26"
  previsto: number;
  recebido: number;
}

export interface BillingDaySummary {
  dateISO: string; // YYYY-MM-DD
  dayOfMonth: number;
  clientCount: number;
  totalAmount: number;
  overdueCount: number;
  paidCount: number;
  pendingCount: number;
  items: InstallmentWithStatus[];
}

export interface ClientTotals {
  totalContratado: number;
  totalPago: number;
  saldoRestante: number;
  situacao: 'Em dia' | 'Com atraso' | 'Quitado' | 'Aguardando êxito';
  paidCount: number;
  totalInstallmentsCount: number;
}

export type ActiveTab =
  | 'dashboard'
  | 'calendario'
  | 'clientes'
  | 'metas'
  | 'configuracoes';

export type DataSourceMode = 'demo' | 'google_workspace' | 'apps_script';

export interface SyncConfig {
  appsScriptUrl: string;
  spreadsheetId: string;
  spreadsheetName: string;
  driveRootFolderName: string;
  lastSyncedAt: string | null;
  sourceMode: DataSourceMode;
  readOnlyMode: boolean;
}

export interface SheetTabArchitecture {
  title: string;
  sheetId: number;
  headerRowNumber: number; // 1-indexed
  headers: string[];
  totalRows: number;
  dataRowsCount: number;
  recognizedColumns: {
    clientName?: string;
    phone?: string;
    caseType?: string;
    driveStage?: string;
    modality?: string;
    amount?: string;
    installmentNumber?: string;
    dueDate?: string;
    paidDateOrStatus?: string;
    driveUrl?: string;
  };
}

export interface DriveFolderNode {
  id: string;
  name: string;
  webViewLink?: string;
  parents?: string[];
}

export interface DriveArchitectureSummary {
  rootFolderId: string | null;
  rootFolderName: string | null;
  rootFolderUrl: string | null;
  stageFolders: Array<{
    stage: DriveStage;
    folderName: string;
    folderUrl: string;
    clientCount: number;
  }>;
  directClientFoldersCount: number;
  totalClientFoldersCount: number;
  sampleClientFolderNames: string[];
  clientFolderLinks: Record<string, string>;
  clientStageByName: Record<string, DriveStage>;
}

export interface WorkspaceArchitectureSnapshot {
  inspectedAt: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  activeTabTitle: string;
  tabs: SheetTabArchitecture[];
  drive: DriveArchitectureSummary;
  parsedClientsCount: number;
  parsedInstallmentsCount: number;
}

export interface AppsScriptClientRow {
  id?: string | number;
  nome?: string;
  cpf?: string;
  telefone?: string;
  whatsapp?: string;
  acao?: string;
  totalContratado?: number | string;
  totalPago?: number | string;
  saldoRestante?: number | string;
  primeiroVencimento?: string;
  situacao?: string;
  modalidade?: string;
  parcelasRegulares?: number | string;
  entrada?: number | string;
  exitoPercentual?: number | string;
}

export interface AppsScriptInstallmentRow {
  idParcela?: string | number;
  idCliente?: string | number;
  cliente?: string;
  parcela?: string | number;
  vencimento?: string;
  previsto?: number | string;
  recebido?: number | string;
  faltaReceber?: number | string;
  situacao?: string;
  ultimoPagamento?: string;
  alerta?: string;
  dataConfirmada?: string;
}

export interface AppsScriptDriveEtapaRow {
  etapa?: string;
  nomePasta?: string;
  urlPasta?: string;
  arquivos?: Array<{
    id?: string;
    nome?: string;
    mimeType?: string;
    url?: string;
    atualizadoEm?: string;
  }>;
}

export interface AppsScriptCalendarEventRow {
  id?: string;
  titulo?: string;
  inicio?: string;
  fim?: string;
  descricao?: string;
}

export interface AppsScriptPayload {
  clientes?: AppsScriptClientRow[];
  parcelas?: AppsScriptInstallmentRow[];
  driveEtapas?: AppsScriptDriveEtapaRow[];
  eventosAgenda?: AppsScriptCalendarEventRow[];
}

export interface AppsScriptSyncResult {
  clients: ClientCase[];
  calendarEvents: AppsScriptCalendarEventRow[];
  summary: {
    syncedAt: string;
    clientesCount: number;
    parcelasCount: number;
    driveEtapasCount: number;
    matchedDriveCount: number;
    driveFilesCount: number;
    eventosAgendaCount: number;
  };
}

export interface DriveFileContentResponse {
  nome: string;
  mimeType: string;
  formato: 'base64' | 'texto';
  conteudo: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  createdAt: string;
  attachedDocument?: {
    fileId: string;
    fileName: string;
    clientName?: string;
    mimeType: string;
  };
}

export type SimulatorPresetId = 'conservador' | 'meta' | 'expansao';

export interface SimulatorInputs {
  monthlyAdsSpend: number;
  costPerLead: number;
  conversionRatePct: number;
  averageTicket: number;
  averageInstallments: number;
  estimatedDefaultPct: number;
}

export interface SimulatorOutputs {
  estimatedLeads: number;
  closedContractsPerMonth: number;
  grossContractedRevenue: number;
  addedMonthlyRecurringRevenue: number;
  netCashAfterDefault: number;
  projectedRoiPct: number;
  roiMultiple: number;
}

export interface PortfolioBaseline {
  averageTicket: number;
  averageInstallments: number;
  observedDefaultPct: number;
  fixedContractsCount: number;
}

export interface ProjectionChartPoint {
  monthKey: string;
  label: string;
  meta: number;
  previsto: number;
  recebido: number;
  projecao: number;
}

export interface ZapSignSigner {
  name: string;
  email?: string;
  phone?: string;
  signedAt?: string;
}

export interface ZapSignSignedDoc {
  token: string;
  name: string;
  status: 'signed';
  createdAt: string;
  signedAt: string;
  signedFileUrl?: string;
  signers: ZapSignSigner[];
}

export interface ZapSignState {
  configured: boolean;
  loading: boolean;
  error: string | null;
  lastFetchedAt: string | null;
  docs: ZapSignSignedDoc[];
}


