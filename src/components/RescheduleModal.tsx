import React, { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { InstallmentWithStatus } from '../types/honorarios';
import { formatCurrencyBRL, formatDateBR } from '../utils/honorariosLogic';

interface RescheduleModalProps {
  item: InstallmentWithStatus | null;
  hasGoogleSync: boolean;
  readOnlyMode: boolean;
  onConfirm: (item: InstallmentWithStatus, newDueDateISO: string) => void;
  onClose: () => void;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  item,
  hasGoogleSync,
  readOnlyMode,
  onConfirm,
  onClose,
}) => {
  const [newDate, setNewDate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (item) {
      setNewDate(item.dueDate);
      setError('');
    }
  }, [item]);

  if (!item) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) {
      setError('Selecione uma nova data de vencimento.');
      return;
    }
    onConfirm(item, newDate);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[#313131]/15 bg-[#F6F3EC] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="reschedule-modal-title"
              className="font-serif text-lg font-bold text-[#313131]"
            >
              Alterar Data de Vencimento
            </h3>
            <p className="mt-1 text-xs text-[#313131]/70 tabular-nums">
              {item.clientName} · Parcela {item.installmentNumber}/
              {item.totalInstallments} · {formatCurrencyBRL(item.amount)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar alteração de data"
            className="rounded-md p-1 text-[#313131]/55 hover:bg-[#313131]/5 hover:text-[#313131]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="rounded-lg border border-[#313131]/12 bg-white px-4 py-3 text-xs text-[#313131]/75">
            <div className="flex items-center justify-between">
              <span>Vencimento atual:</span>
              <span className="font-semibold text-[#313131] tabular-nums">
                {formatDateBR(item.dueDate)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span>Horário padrão na agenda:</span>
              <span className="font-medium text-[#313131] tabular-nums">
                13h30 às 14h30
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="new-due-date"
              className="block text-xs font-medium text-[#313131]/85"
            >
              Nova data de cobrança
            </label>
            <div className="relative mt-1.5">
              <input
                id="new-due-date"
                type="date"
                value={newDate}
                onChange={(e) => {
                  setNewDate(e.target.value);
                  setError('');
                }}
                className="w-full rounded-lg border border-[#313131]/20 bg-white px-3.5 py-2.5 text-sm text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
          </div>

          {hasGoogleSync && (
            <p className="text-xs text-[#313131]/65 leading-relaxed">
              {readOnlyMode
                ? 'Modo Somente Leitura ativo: a nova data será aplicada apenas na visualização do painel e não alterará a planilha oficial.'
                : 'Ao confirmar, a nova data também será atualizada na planilha e no evento das 13h30 às 14h30 no Google Calendar.'}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#313131]/20 bg-white px-4 py-2 text-sm font-medium text-[#313131] hover:bg-[#313131]/5 whitespace-nowrap shrink-0"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-[#313131] px-4 py-2 text-sm font-medium text-[#FFFFFF] hover:bg-[#313131]/90 whitespace-nowrap shrink-0"
            >
              <CalendarClock className="h-4 w-4 text-[#FFD559]" />
              Confirmar Nova Data
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
