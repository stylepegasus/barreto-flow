import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FileSignature,
  FolderOpen,
  Link2,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import {
  ClientCase,
  DRIVE_STAGES,
  DriveStage,
  PAYMENT_MODALITIES,
  PaymentModality,
  ZapSignCrossReferenceItem,
} from '../types/honorarios';
import { formatZapSignDateBR } from '../utils/zapsignLogic';
import { resolveStage } from '../utils/sheetArchitecture';

export interface ZapSignPrefilledClientDraft {
  fullName: string;
  cpf?: string;
  phone: string;
  caseType: string;
  driveStage: DriveStage;
  driveFolderUrl: string;
  modality: PaymentModality;
  contractedTotal: number;
  signedAt: string;
  docToken: string;
}

interface ZapSignRegistrationModalProps {
  item: ZapSignCrossReferenceItem | null;
  existingClients: ClientCase[];
  readOnlyMode: boolean;
  onCreateClientFromZapSign: (draft: ZapSignPrefilledClientDraft) => void;
  onLinkToExistingClient: (docToken: string, clientId: string) => void;
  onClose: () => void;
}

export const ZapSignRegistrationModal: React.FC<
  ZapSignRegistrationModalProps
> = ({
  item,
  existingClients,
  readOnlyMode,
  onCreateClientFromZapSign,
  onLinkToExistingClient,
  onClose,
}) => {
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [caseType, setCaseType] = useState('Direito de Família');
  const [driveStage, setDriveStage] = useState<DriveStage>(DRIVE_STAGES[0]);
  const [modality, setModality] = useState<PaymentModality>('Parcelado');
  const [contractedTotalInput, setContractedTotalInput] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [copiedSummary, setCopiedSummary] = useState(false);

  useEffect(() => {
    if (!item) return;
    const profile = item.extractedProfile;
    setMode('create');
    setFullName(profile?.cleanName || item.primarySignerName || '');
    setCpf(profile?.cpf || '');
    setPhone(profile?.phone || '');
    setCaseType('Direito de Família');
    setDriveStage(
      item.driveFolder?.etapa ? resolveStage(item.driveFolder.etapa) : DRIVE_STAGES[0]
    );
    setModality('Parcelado');
    setContractedTotalInput('');
    setLinkSearch('');
    setSelectedClientId('');
    setCopiedSummary(false);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  const filteredExistingClients = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    if (!q) return existingClients.slice(0, 25);
    return existingClients
      .filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          (c.cpf ?? '').toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q)
      )
      .slice(0, 25);
  }, [existingClients, linkSearch]);

  if (!item) return null;

  const signedDateBR = formatZapSignDateBR(item.doc.signedAt);

  const handleCopyForSheet = async () => {
    const summaryLines = [
      `Cliente: ${fullName.trim() || item.primarySignerName}`,
      cpf.trim() ? `CPF: ${cpf.trim()}` : null,
      phone.trim() ? `Telefone: ${phone.trim()}` : null,
      `Assinatura ZapSign: ${signedDateBR || item.doc.signedAt}`,
      `Modalidade: ${modality}`,
      contractedTotalInput.trim()
        ? `Total Contratado: R$ ${contractedTotalInput.trim()}`
        : null,
      item.driveFolder
        ? `Pasta Drive: ${item.driveFolder.nomePasta} (${item.driveFolder.etapa}) — ${item.driveFolder.urlPasta}`
        : 'Pasta Drive: Não localizada',
      item.doc.signedFileUrl ? `PDF ZapSign: ${item.doc.signedFileUrl}` : null,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(summaryLines.join('\n'));
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedName = fullName.trim();
    if (!cleanedName) return;
    const parsedTotal = Number(
      contractedTotalInput.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
    );
    onCreateClientFromZapSign({
      fullName: cleanedName,
      cpf: cpf.trim() || undefined,
      phone: phone.trim() || '11999999999',
      caseType: caseType.trim() || 'Direito de Família',
      driveStage,
      driveFolderUrl:
        item.driveFolder?.urlPasta || 'https://drive.google.com/drive/my-drive',
      modality,
      contractedTotal: Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 0,
      signedAt: item.doc.signedAt,
      docToken: item.doc.token,
    });
  };

  const handleConfirmLink = () => {
    if (!selectedClientId) return;
    onLinkToExistingClient(item.doc.token, selectedClientId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#313131]/55 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zapsign-prefill-title"
        data-testid="zapsign-registration-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-[#313131]/15 bg-[#F6F3EC] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-[#313131] px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium text-[#DCB14A]">
              <FileSignature className="h-3.5 w-3.5 shrink-0" />
              <span>Auditoria ZapSign · Pré-preenchimento</span>
            </div>
            <h2
              id="zapsign-prefill-title"
              className="mt-1 font-serif text-base font-bold text-white truncate"
            >
              {item.extractedProfile?.cleanName || item.primarySignerName}
            </h2>
            <p className="mt-0.5 text-[11px] text-[#F6F3EC]/70 truncate">
              {item.doc.name}
              {signedDateBR ? ` · Assinado em ${signedDateBR}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar pré-preenchimento ZapSign"
            className="rounded-md p-1.5 text-[#F6F3EC]/75 hover:bg-white/10 hover:text-white shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Multi-source Diagnosis Strip */}
        <div className="border-b border-[#313131]/10 bg-white px-5 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {item.driveFolder ? (
              <a
                href={item.driveFolder.urlPasta}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-[#DCB14A]/70 bg-[#F6F3EC] px-2 py-0.5 font-medium text-[#313131] hover:border-[#8D6A14]"
              >
                <FolderOpen className="h-3 w-3 text-[#8D6A14]" />
                Pasta Drive encontrada ({item.driveFolder.etapa})
                <ExternalLink className="h-2.5 w-2.5 opacity-60" />
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-[#313131]/15 bg-[#F6F3EC]/70 px-2 py-0.5 text-[#313131]/65">
                Sem pasta no Drive
              </span>
            )}

            {item.calendarMatch && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-700/30 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900">
                <CalendarDays className="h-3 w-3 text-emerald-700" />
                Evento no Calendar ({item.calendarMatch.eventCount})
              </span>
            )}

            <span className="inline-flex items-center rounded border border-amber-700/30 bg-amber-50 px-2 py-0.5 font-medium text-amber-900">
              Não encontrado na planilha
            </span>

            {item.doc.signedFileUrl && (
              <a
                href={item.doc.signedFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 font-semibold text-[#8D6A14] hover:underline"
              >
                Ver PDF assinado
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {item.matchReason && (
            <p className="text-[11px] text-[#313131]/65">
              Diagnóstico: {item.matchReason}
            </p>
          )}
        </div>

        {/* Mode Switcher */}
        <div className="flex border-b border-[#313131]/12 bg-[#F6F3EC] px-5 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`inline-flex items-center gap-1.5 rounded-t-lg border-x border-t px-3 py-2 text-xs font-medium transition-colors ${
              mode === 'create'
                ? 'border-[#313131]/15 bg-white text-[#313131]'
                : 'border-transparent text-[#313131]/65 hover:text-[#313131]'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5 text-[#8D6A14]" />
            Novo cadastro pré-preenchido
          </button>
          <button
            type="button"
            onClick={() => setMode('link')}
            className={`inline-flex items-center gap-1.5 rounded-t-lg border-x border-t px-3 py-2 text-xs font-medium transition-colors ${
              mode === 'link'
                ? 'border-[#313131]/15 bg-white text-[#313131]'
                : 'border-transparent text-[#313131]/65 hover:text-[#313131]'
            }`}
          >
            <Link2 className="h-3.5 w-3.5 text-[#8D6A14]" />
            Vincular a cliente existente
          </button>
        </div>

        {/* Body */}
        <div className="bg-white px-5 py-4">
          {mode === 'create' ? (
            <form onSubmit={handleCreateSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="zs-prefill-name"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    Nome completo da cliente
                  </label>
                  <input
                    id="zs-prefill-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="zs-prefill-cpf"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    CPF (ZapSign)
                  </label>
                  <input
                    id="zs-prefill-cpf"
                    type="text"
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] tabular-nums focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="zs-prefill-phone"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    Telefone / WhatsApp
                  </label>
                  <input
                    id="zs-prefill-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+55 61 99999-0000"
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] tabular-nums focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="zs-prefill-stage"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    Etapa no Google Drive
                  </label>
                  <select
                    id="zs-prefill-stage"
                    value={driveStage}
                    onChange={(e) => setDriveStage(e.target.value as DriveStage)}
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  >
                    {DRIVE_STAGES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="zs-prefill-modality"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    Modalidade
                  </label>
                  <select
                    id="zs-prefill-modality"
                    value={modality}
                    onChange={(e) =>
                      setModality(e.target.value as PaymentModality)
                    }
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  >
                    {PAYMENT_MODALITIES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="zs-prefill-case"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    Tipo de ação / Objeto
                  </label>
                  <input
                    id="zs-prefill-case"
                    type="text"
                    value={caseType}
                    onChange={(e) => setCaseType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="zs-prefill-total"
                    className="block text-[11px] font-medium text-[#313131]/75"
                  >
                    Honorários contratados (R$)
                  </label>
                  <input
                    id="zs-prefill-total"
                    type="text"
                    inputMode="decimal"
                    value={contractedTotalInput}
                    onChange={(e) => setContractedTotalInput(e.target.value)}
                    placeholder="Ex.: 3000,00"
                    className="mt-1 w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 px-3 py-2 text-xs text-[#313131] tabular-nums focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              {readOnlyMode && (
                <p className="rounded-lg border border-[#DCB14A]/50 bg-[#F6F3EC] px-3 py-2 text-[11px] text-[#313131]/80">
                  <strong className="font-semibold text-[#313131]">
                    Modo Somente Leitura:
                  </strong>{' '}
                  o cadastro adicionado aqui entra na visualização local do painel
                  sem alterar a planilha oficial. Use &ldquo;Copiar resumo p/
                  Planilha&rdquo; para colar rapidamente na planilha oficial.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#313131]/10">
                <button
                  type="button"
                  onClick={handleCopyForSheet}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/20 bg-[#F6F3EC] px-3 py-2 text-xs font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-white"
                >
                  {copiedSummary ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-700" />
                      Resumo copiado
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-[#8D6A14]" />
                      Copiar resumo p/ Planilha
                    </>
                  )}
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#313131] px-4 py-2 text-xs font-medium text-[#FFD559] hover:bg-[#313131]/90"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {readOnlyMode
                    ? 'Pré-cadastrar no painel'
                    : 'Adicionar cliente'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#313131]/45" />
                <input
                  type="text"
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
                  aria-label="Buscar cliente existente na planilha"
                  placeholder="Buscar cliente já cadastrada na planilha por nome, CPF ou telefone..."
                  className="w-full rounded-lg border border-[#313131]/20 bg-[#F6F3EC]/60 pl-8 pr-3 py-2 text-xs text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                />
              </div>

              <div className="max-h-52 overflow-y-auto divide-y divide-[#313131]/10 rounded-lg border border-[#313131]/12">
                {filteredExistingClients.length === 0 ? (
                  <p className="p-4 text-center text-xs text-[#313131]/60">
                    Nenhuma cliente encontrada com esse filtro.
                  </p>
                ) : (
                  filteredExistingClients.map((client) => {
                    const isSelected = selectedClientId === client.id;
                    return (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => setSelectedClientId(client.id)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-[#DCB14A]/20 text-[#313131]'
                            : 'hover:bg-[#F6F3EC]/70 text-[#313131]'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {client.fullName}
                          </p>
                          <p className="text-[11px] text-[#313131]/65 truncate">
                            {client.driveStage}
                            {client.cpf ? ` · CPF ${client.cpf}` : ''}
                          </p>
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 shrink-0 text-[#8D6A14]" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#313131]/10">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[#313131]/20 bg-white px-3 py-2 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!selectedClientId}
                  onClick={handleConfirmLink}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#313131] px-4 py-2 text-xs font-medium text-[#FFD559] hover:bg-[#313131]/90 disabled:opacity-45"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Vincular contrato
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
