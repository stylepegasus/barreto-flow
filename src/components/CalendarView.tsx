import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageCircle,
} from 'lucide-react';
import {
  BillingDaySummary,
  ClientCase,
  InstallmentWithStatus,
} from '../types/honorarios';
import {
  MONTH_NAMES_PT,
  formatCurrencyBRL,
  formatCurrencyCompactBRL,
  formatDateBR,
  groupInstallmentsByBillingDay,
} from '../utils/honorariosLogic';

interface CalendarViewProps {
  clients: ClientCase[];
  todayISO: string;
  onQuitarParcela: (item: InstallmentWithStatus) => void;
  onAlterarData: (item: InstallmentWithStatus) => void;
  onOpenWhatsApp: (item: InstallmentWithStatus) => void;
}

const WEEKDAY_NAMES_PT = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

function getWeekdayLabel(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAY_NAMES_PT[date.getUTCDay()];
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  clients,
  todayISO,
  onQuitarParcela,
  onAlterarData,
  onOpenWhatsApp,
}) => {
  const [initialYear, initialMonth] = todayISO.split('-').map(Number);
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  const billingDays: BillingDaySummary[] = groupInstallmentsByBillingDay(
    clients,
    viewYear,
    viewMonth,
    todayISO
  );

  const [selectedDateISO, setSelectedDateISO] = useState<string | null>(() => {
    const day20 = billingDays.find((d) => d.dayOfMonth === 20);
    return day20?.dateISO ?? billingDays[0]?.dateISO ?? null;
  });

  useEffect(() => {
    if (billingDays.length === 0) {
      setSelectedDateISO(null);
      return;
    }
    const stillExists = billingDays.some((d) => d.dateISO === selectedDateISO);
    if (!stillExists) {
      const day20 = billingDays.find((d) => d.dayOfMonth === 20);
      setSelectedDateISO(day20?.dateISO ?? billingDays[0].dateISO);
    }
  }, [viewYear, viewMonth, billingDays, selectedDateISO]);

  const selectedDay =
    billingDays.find((d) => d.dateISO === selectedDateISO) ?? null;

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const monthTotal = billingDays.reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#313131]/12 pb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#313131]">
            Calendário de Cobranças
          </h1>
          <p className="mt-1.5 text-sm text-[#313131]/70 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#8D6A14] shrink-0" />
            <span>
              Mostrando apenas os dias com clientes para cobrar · Horário padrão:{' '}
              <strong className="font-semibold text-[#313131] tabular-nums">
                13h30 às 14h30
              </strong>
            </span>
          </p>
        </div>

        {/* Month Selector */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="Mês anterior"
            className="rounded-lg border border-[#313131]/20 bg-white p-2 text-[#313131] hover:bg-[#313131]/5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[155px] text-center font-serif text-base font-bold text-[#313131]">
            {MONTH_NAMES_PT[viewMonth - 1]} {viewYear}
          </span>
          <button
            type="button"
            onClick={handleNextMonth}
            aria-label="Próximo mês"
            className="rounded-lg border border-[#313131]/20 bg-white p-2 text-[#313131] hover:bg-[#313131]/5"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {billingDays.length === 0 ? (
        <div className="rounded-xl border border-[#313131]/12 bg-white p-12 text-center">
          <CalendarClock className="mx-auto h-9 w-9 text-[#8D6A14]" />
          <h2 className="mt-4 font-serif text-lg font-bold text-[#313131]">
            Nenhuma cobrança agendada em {MONTH_NAMES_PT[viewMonth - 1]}
          </h2>
          <p className="mt-1.5 text-sm text-[#313131]/65">
            Navegue para outro mês para visualizar os dias de vencimento.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left: Clean Calendar of ONLY Billing Days */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between text-xs text-[#313131]/70 px-1">
              <span className="tabular-nums">
                {billingDays.length}{' '}
                {billingDays.length === 1
                  ? 'dia com vencimento no mês'
                  : 'dias com vencimento no mês'}
              </span>
              <span className="tabular-nums">
                Total previsto no mês:{' '}
                <strong className="text-[#313131]">
                  {formatCurrencyBRL(monthTotal)}
                </strong>
              </span>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              data-testid="billing-days-grid"
            >
              {billingDays.map((day) => {
                const isSelected = day.dateISO === selectedDay?.dateISO;
                const isToday = day.dateISO === todayISO;
                const allPaid = day.pendingCount === 0;
                const clientLabel =
                  day.clientCount === 1
                    ? '1 cliente'
                    : `${day.clientCount} clientes`;

                return (
                  <button
                    key={day.dateISO}
                    type="button"
                    onClick={() => setSelectedDateISO(day.dateISO)}
                    aria-pressed={isSelected}
                    className={`w-full text-left rounded-xl border p-4 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#DCB14A] ${
                      isSelected
                        ? 'border-[#313131] bg-[#313131] text-[#FFFFFF]'
                        : 'border-[#313131]/12 bg-white text-[#313131] hover:border-[#DCB14A]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-medium ${
                          isSelected ? 'text-[#FFD559]' : 'text-[#313131]/60'
                        }`}
                      >
                        {getWeekdayLabel(day.dateISO)}
                        {isToday ? ' · Hoje' : ''}
                      </span>

                      {day.overdueCount > 0 ? (
                        <span
                          className={`text-xs font-semibold ${
                            isSelected ? 'text-red-300' : 'text-red-700'
                          }`}
                        >
                          {day.overdueCount} atrasada
                          {day.overdueCount > 1 ? 's' : ''}
                        </span>
                      ) : allPaid ? (
                        <span
                          className={`text-xs font-semibold ${
                            isSelected ? 'text-emerald-300' : 'text-emerald-700'
                          }`}
                        >
                          Tudo quitado
                        </span>
                      ) : (
                        <span
                          className={`text-xs font-medium ${
                            isSelected ? 'text-white/80' : 'text-[#313131]/55'
                          }`}
                        >
                          13h30–14h30
                        </span>
                      )}
                    </div>

                    <p className="mt-2 font-serif text-lg font-bold tabular-nums">
                      {String(day.dayOfMonth).padStart(2, '0')} de{' '}
                      {MONTH_NAMES_PT[viewMonth - 1]}
                    </p>

                    <p
                      className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
                        isSelected
                          ? 'bg-[#DCB14A]/20 text-[#FFD559]'
                          : 'bg-[#F6F3EC] text-[#313131]/85'
                      }`}
                    >
                      Dia {day.dayOfMonth} • {clientLabel} •{' '}
                      {formatCurrencyCompactBRL(day.totalAmount)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Lateral Detail Panel for Selected Day */}
          <aside
            aria-label="Detalhes das cobranças do dia selecionado"
            className="lg:col-span-5 rounded-xl border border-[#313131]/12 bg-white p-6 lg:sticky lg:top-6"
          >
            {selectedDay ? (
              <div>
                <div className="border-b border-[#313131]/12 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-serif text-xl font-bold text-[#313131] tabular-nums">
                      Dia {String(selectedDay.dayOfMonth).padStart(2, '0')} —{' '}
                      {MONTH_NAMES_PT[viewMonth - 1]}
                    </h2>
                    <span className="text-xs font-semibold text-[#8D6A14] tabular-nums whitespace-nowrap">
                      13h30 às 14h30
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#313131]/70 tabular-nums">
                    {selectedDay.clientCount}{' '}
                    {selectedDay.clientCount === 1 ? 'cliente' : 'clientes'} ·
                    Total do dia:{' '}
                    <strong className="font-semibold text-[#313131]">
                      {formatCurrencyBRL(selectedDay.totalAmount)}
                    </strong>
                  </p>
                </div>

                <div className="mt-4 divide-y divide-[#313131]/10 max-h-[600px] overflow-y-auto pr-1">
                  {selectedDay.items.map((item) => {
                    const isPaid = item.status === 'Paga';
                    const isOverdue = item.status === 'Atrasada';

                    return (
                      <div key={item.id} className="py-4 first:pt-1 last:pb-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-[#313131]">
                              {item.clientName}
                            </p>
                            <p className="mt-0.5 text-xs text-[#313131]/65 tabular-nums">
                              Parcela {item.installmentNumber}/
                              {item.totalInstallments} ·{' '}
                              <span
                                className={`font-semibold ${
                                  isPaid
                                    ? 'text-emerald-700'
                                    : isOverdue
                                      ? 'text-red-700'
                                      : 'text-[#8D6A14]'
                                }`}
                              >
                                {item.status}
                              </span>
                            </p>
                          </div>

                          <p className="font-semibold text-sm text-[#313131] tabular-nums whitespace-nowrap">
                            {formatCurrencyBRL(item.amount)}
                          </p>
                        </div>

                        {isPaid ? (
                          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="tabular-nums">
                              Quitada em{' '}
                              {formatDateBR(item.paidDate ?? item.dueDate)}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onQuitarParcela(item)}
                              aria-label={`Quitar parcela de ${item.clientName}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#313131] px-3 py-1.5 text-xs font-medium text-[#FFFFFF] hover:bg-[#313131]/90 whitespace-nowrap shrink-0"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#FFD559]" />
                              Quitar Parcela
                            </button>
                            <button
                              type="button"
                              onClick={() => onAlterarData(item)}
                              aria-label={`Alterar data da parcela de ${item.clientName}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/20 bg-white px-3 py-1.5 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap shrink-0"
                            >
                              <CalendarClock className="h-3.5 w-3.5 text-[#313131]/65" />
                              Alterar Data
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenWhatsApp(item)}
                              aria-label={`Enviar lembrete no WhatsApp para ${item.clientName}`}
                              title="Enviar lembrete no WhatsApp"
                              className="inline-flex items-center gap-1 rounded-lg border border-[#313131]/20 bg-white px-2.5 py-1.5 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="h-3.5 w-3.5 text-[#8D6A14]" />
                              WhatsApp
                            </button>
                          </div>
                        )}

                        {isOverdue && (
                          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-700 tabular-nums">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            Vencimento original: {formatDateBR(item.dueDate)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#313131]/65">
                Selecione um dia ao lado para ver as cobranças.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
