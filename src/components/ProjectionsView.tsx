import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RotateCcw, SlidersHorizontal, Target } from 'lucide-react';
import {
  PortfolioBaseline,
  ProjectionChartPoint,
  SimulatorInputs,
  SimulatorOutputs,
  SimulatorPresetId,
} from '../types/honorarios';
import {
  formatCurrencyBRL,
  formatCurrencyCompactBRL,
} from '../utils/honorariosLogic';

interface ProjectionsViewProps {
  currentMonthKey: string;
  baseline: PortfolioBaseline;
  goalsByMonth: Record<string, number>;
  defaultGoal: number;
  onGoalChange: (monthKey: string, value: number) => void;
  onApplyDefaultGoalToUpcoming: (goalValue: number) => void;
  activePreset: SimulatorPresetId | 'custom';
  simulatorInputs: SimulatorInputs;
  simulatorOutputs: SimulatorOutputs;
  chartData: ProjectionChartPoint[];
  onSelectPreset: (preset: SimulatorPresetId) => void;
  onUpdateSimulatorInputs: (patch: Partial<SimulatorInputs>) => void;
  onResetSimulatorBaseline: () => void;
}

const PRESET_OPTIONS: Array<{
  id: SimulatorPresetId;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'conservador',
    label: 'Conservador',
    subtitle: 'R$ 2.500/mês · 8% conv.',
  },
  {
    id: 'meta',
    label: 'Meta Escritório',
    subtitle: 'R$ 4.500/mês · 12% conv.',
  },
  {
    id: 'expansao',
    label: 'Expansão',
    subtitle: 'R$ 8.500/mês · 15% conv.',
  },
];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
  }>;
  label?: string;
}

const ProjectionsTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-[#313131]/15 bg-white p-3 text-xs shadow-lg">
      <p className="font-serif font-bold text-[#313131] mb-1.5">{label}</p>
      <div className="space-y-1 tabular-nums">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-[#313131]/80">
              <span
                className="h-2.5 w-2.5 rounded-xs shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-semibold text-[#313131]">
              {formatCurrencyBRL(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ProjectionsView: React.FC<ProjectionsViewProps> = ({
  currentMonthKey,
  baseline,
  goalsByMonth,
  defaultGoal,
  onGoalChange,
  onApplyDefaultGoalToUpcoming,
  activePreset,
  simulatorInputs,
  simulatorOutputs,
  chartData,
  onSelectPreset,
  onUpdateSimulatorInputs,
  onResetSimulatorBaseline,
}) => {
  const [batchGoalInput, setBatchGoalInput] = useState<string>(
    String(defaultGoal)
  );
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);

  const editableMonths = chartData.filter(
    (point) => point.monthKey >= currentMonthKey
  );

  const handleApplyBatch = (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(batchGoalInput);
    if (!Number.isFinite(numeric) || numeric < 0) return;
    onApplyDefaultGoalToUpcoming(Math.round(numeric));
    setBatchFeedback(
      `Meta de ${formatCurrencyBRL(Math.round(numeric))} aplicada aos próximos meses.`
    );
    setTimeout(() => setBatchFeedback(null), 3500);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-[#313131]/12 pb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#313131]">
            Metas &amp; Projeções
          </h1>
          <p className="mt-1.5 text-sm text-[#313131]/70">
            Compare metas mensais, previsto na planilha, recebido real e
            simulações de crescimento com Tráfego Pago.
          </p>
        </div>
        <p className="text-xs font-medium text-[#313131]/65 tabular-nums whitespace-nowrap">
          Base da planilha: Ticket médio{' '}
          <strong className="text-[#313131]">
            {formatCurrencyBRL(baseline.averageTicket)}
          </strong>{' '}
          em {baseline.averageInstallments}x · Inadimplência observada{' '}
          <strong className="text-[#313131]">
            {baseline.observedDefaultPct.toFixed(1).replace('.', ',')}%
          </strong>
        </p>
      </div>

      {/* Section 1: Recharts Bar Chart */}
      <section
        aria-label="Comparativo Meta, Previsto, Recebido e Projeção"
        className="rounded-xl border border-[#313131]/12 bg-white p-6 space-y-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#313131]">
              Evolução: Meta × Previsto × Recebido × Projeção Simulada
            </h2>
            <p className="mt-0.5 text-xs text-[#313131]/65">
              Histórico recente e horizonte dos próximos 6 meses atualizado em
              tempo real pelo simulador abaixo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#313131]/80">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#A8A29E]" />
              Meta
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#313131]" />
              Previsto na Planilha
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#DCB14A]" />
              Recebido Real
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#FFD559]" />
              Projeção Simulada
            </span>
          </div>
        </div>

        <div className="h-[340px] w-full" data-testid="projections-recharts-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 12, left: 4, bottom: 4 }}
              barGap={2}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="rgba(49,49,49,0.1)"
              />
              <XAxis
                dataKey="label"
                tick={{ fill: '#313131', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(49,49,49,0.15)' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(val: number) => formatCurrencyCompactBRL(val)}
                tick={{ fill: '#313131', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={76}
              />
              <Tooltip content={<ProjectionsTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
              />
              <Bar
                dataKey="meta"
                name="Meta"
                fill="#A8A29E"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="previsto"
                name="Previsto na Planilha"
                fill="#313131"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="recebido"
                name="Recebido Real"
                fill="#DCB14A"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="projecao"
                name="Projeção Simulada"
                fill="#FFD559"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Section 2: Editable Monthly Goals */}
      <section
        aria-label="Metas mensais editáveis"
        className="rounded-xl border border-[#313131]/12 bg-white p-6 space-y-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-[#313131]/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[#8D6A14]" />
              <h2 className="font-serif text-lg font-bold text-[#313131]">
                Metas de Recebimento Mensal
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#313131]/65">
              Edite o valor de cada mês diretamente abaixo (salvo automaticamente
              neste navegador).
            </p>
          </div>

          <form
            onSubmit={handleApplyBatch}
            className="flex flex-wrap items-end gap-2.5"
          >
            <div>
              <label
                htmlFor="batch-default-goal"
                className="block text-[11px] font-medium text-[#313131]/75"
              >
                Meta padrão para próximos meses (R$)
              </label>
              <input
                id="batch-default-goal"
                type="number"
                min={0}
                step={500}
                value={batchGoalInput}
                onChange={(e) => setBatchGoalInput(e.target.value)}
                className="mt-1 w-40 rounded-lg border border-[#313131]/20 bg-[#F6F3EC] px-3 py-1.5 text-sm font-medium text-[#313131] tabular-nums focus:border-[#DCB14A] focus:bg-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-[#313131] px-4 py-2 text-xs font-medium text-white hover:bg-[#313131]/90 whitespace-nowrap shrink-0"
            >
              Aplicar aos próximos meses
            </button>
          </form>
        </div>

        {batchFeedback && (
          <p role="status" className="text-xs font-medium text-emerald-800">
            {batchFeedback}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {editableMonths.map((point) => {
            const currentVal = goalsByMonth[point.monthKey] ?? defaultGoal;
            return (
              <div
                key={point.monthKey}
                className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/70 p-3"
              >
                <label
                  htmlFor={`goal-input-${point.monthKey}`}
                  className="block text-xs font-semibold text-[#313131]"
                >
                  {point.label}
                </label>
                <input
                  id={`goal-input-${point.monthKey}`}
                  type="number"
                  min={0}
                  step={500}
                  value={currentVal}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    if (Number.isFinite(num) && num >= 0) {
                      onGoalChange(point.monthKey, num);
                    }
                  }}
                  className="mt-1.5 w-full rounded-md border border-[#313131]/18 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[#313131]/60 tabular-nums">
                  Previsto: {formatCurrencyCompactBRL(point.previsto)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 3: Ads × Revenue × Default Simulator */}
      <section
        aria-label="Simulador Investimento, Faturamento e Inadimplência"
        className="rounded-xl border border-[#313131]/12 bg-white p-6 space-y-6"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between border-b border-[#313131]/10 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[#8D6A14] shrink-0" />
              <h2 className="font-serif text-lg font-bold text-[#313131]">
                Simulador: Investimento × Faturamento × Inadimplência
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#313131]/65">
              Ajuste os parâmetros de Tráfego Pago e compare cenários prontos
              partindo do ticket médio real da planilha.
            </p>
          </div>

          <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 shrink-0">
            {PRESET_OPTIONS.map((preset) => {
              const isSelected = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectPreset(preset.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'border-[#DCB14A] bg-[#313131] text-white'
                      : 'border-[#313131]/20 bg-[#F6F3EC] text-[#313131] hover:bg-white'
                  }`}
                >
                  <span className="block font-semibold">{preset.label}</span>
                  <span
                    className={`block text-[10px] ${
                      isSelected ? 'text-[#FFD559]' : 'text-[#313131]/65'
                    }`}
                  >
                    {preset.subtitle}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={onResetSimulatorBaseline}
              title="Restaurar médias reais da planilha"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/20 bg-white px-3 py-2.5 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[#8D6A14]" />
              Base real
            </button>
          </div>
        </div>

        {/* Sliders + Numeric Inputs */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {/* 1. Investimento mensal em Ads */}
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sim-ads-spend"
                className="text-xs font-semibold text-[#313131]"
              >
                Investimento mensal em Ads (R$)
              </label>
              <input
                id="sim-ads-spend"
                type="number"
                min={0}
                max={50000}
                step={250}
                value={simulatorInputs.monthlyAdsSpend}
                onChange={(e) =>
                  onUpdateSimulatorInputs({
                    monthlyAdsSpend: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-28 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-right text-xs font-bold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Controle deslizante de investimento mensal em Ads"
              min={500}
              max={25000}
              step={250}
              value={Math.min(25000, simulatorInputs.monthlyAdsSpend)}
              onChange={(e) =>
                onUpdateSimulatorInputs({
                  monthlyAdsSpend: Number(e.target.value),
                })
              }
              className="w-full accent-[#DCB14A] cursor-pointer"
            />
          </div>

          {/* 2. Custo por Lead (CPL) */}
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sim-cpl"
                className="text-xs font-semibold text-[#313131]"
              >
                Custo por Lead — CPL (R$)
              </label>
              <input
                id="sim-cpl"
                type="number"
                min={5}
                max={500}
                step={1}
                value={simulatorInputs.costPerLead}
                onChange={(e) =>
                  onUpdateSimulatorInputs({
                    costPerLead: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="w-24 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-right text-xs font-bold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Controle deslizante de custo por lead"
              min={10}
              max={150}
              step={1}
              value={Math.min(150, simulatorInputs.costPerLead)}
              onChange={(e) =>
                onUpdateSimulatorInputs({ costPerLead: Number(e.target.value) })
              }
              className="w-full accent-[#DCB14A] cursor-pointer"
            />
          </div>

          {/* 3. Taxa de fechamento / conversão */}
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sim-conversion"
                className="text-xs font-semibold text-[#313131]"
              >
                Taxa de fechamento (%)
              </label>
              <input
                id="sim-conversion"
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={simulatorInputs.conversionRatePct}
                onChange={(e) =>
                  onUpdateSimulatorInputs({
                    conversionRatePct: Math.min(
                      100,
                      Math.max(0, Number(e.target.value) || 0)
                    ),
                  })
                }
                className="w-24 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-right text-xs font-bold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Controle deslizante de taxa de fechamento"
              min={1}
              max={40}
              step={0.5}
              value={Math.min(40, simulatorInputs.conversionRatePct)}
              onChange={(e) =>
                onUpdateSimulatorInputs({
                  conversionRatePct: Number(e.target.value),
                })
              }
              className="w-full accent-[#DCB14A] cursor-pointer"
            />
          </div>

          {/* 4. Ticket médio por contrato */}
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sim-ticket"
                className="text-xs font-semibold text-[#313131]"
              >
                Ticket médio por contrato (R$)
              </label>
              <input
                id="sim-ticket"
                type="number"
                min={200}
                max={50000}
                step={100}
                value={simulatorInputs.averageTicket}
                onChange={(e) =>
                  onUpdateSimulatorInputs({
                    averageTicket: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-28 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-right text-xs font-bold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Controle deslizante de ticket médio"
              min={500}
              max={10000}
              step={100}
              value={Math.min(10000, simulatorInputs.averageTicket)}
              onChange={(e) =>
                onUpdateSimulatorInputs({
                  averageTicket: Number(e.target.value),
                })
              }
              className="w-full accent-[#DCB14A] cursor-pointer"
            />
          </div>

          {/* 5. Número médio de parcelas */}
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sim-installments"
                className="text-xs font-semibold text-[#313131]"
              >
                Nº médio de parcelas (padrão 10x)
              </label>
              <input
                id="sim-installments"
                type="number"
                min={1}
                max={36}
                step={1}
                value={simulatorInputs.averageInstallments}
                onChange={(e) =>
                  onUpdateSimulatorInputs({
                    averageInstallments: Math.min(
                      36,
                      Math.max(1, Math.round(Number(e.target.value) || 1))
                    ),
                  })
                }
                className="w-20 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-right text-xs font-bold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Controle deslizante de número médio de parcelas"
              min={1}
              max={24}
              step={1}
              value={Math.min(24, simulatorInputs.averageInstallments)}
              onChange={(e) =>
                onUpdateSimulatorInputs({
                  averageInstallments: Number(e.target.value),
                })
              }
              className="w-full accent-[#DCB14A] cursor-pointer"
            />
          </div>

          {/* 6. Inadimplência estimada */}
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sim-default"
                className="text-xs font-semibold text-[#313131]"
              >
                Inadimplência estimada (%)
              </label>
              <input
                id="sim-default"
                type="number"
                min={0}
                max={80}
                step={0.5}
                value={simulatorInputs.estimatedDefaultPct}
                onChange={(e) =>
                  onUpdateSimulatorInputs({
                    estimatedDefaultPct: Math.min(
                      80,
                      Math.max(0, Number(e.target.value) || 0)
                    ),
                  })
                }
                className="w-24 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-right text-xs font-bold text-[#313131] tabular-nums focus:border-[#DCB14A] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Controle deslizante de inadimplência estimada"
              min={0}
              max={50}
              step={0.5}
              value={Math.min(50, simulatorInputs.estimatedDefaultPct)}
              onChange={(e) =>
                onUpdateSimulatorInputs({
                  estimatedDefaultPct: Number(e.target.value),
                })
              }
              className="w-full accent-[#DCB14A] cursor-pointer"
            />
          </div>
        </div>

        {/* Simulated Output KPI Cards */}
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="simulator-outputs-grid"
        >
          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/45 p-4">
            <p className="text-xs text-[#313131]/65">Leads estimados / mês</p>
            <p className="mt-1.5 text-xl font-bold text-[#313131] tabular-nums">
              {simulatorOutputs.estimatedLeads.toFixed(1).replace('.', ',')}{' '}
              leads
            </p>
          </div>

          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/45 p-4">
            <p className="text-xs text-[#313131]/65">
              Contratos fechados / mês
            </p>
            <p className="mt-1.5 text-xl font-bold text-[#313131] tabular-nums">
              {simulatorOutputs.closedContractsPerMonth
                .toFixed(1)
                .replace('.', ',')}{' '}
              contratos
            </p>
          </div>

          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/45 p-4">
            <p className="text-xs text-[#313131]/65">
              Faturamento bruto contratado
            </p>
            <p className="mt-1.5 text-xl font-bold text-[#313131] tabular-nums">
              {formatCurrencyBRL(simulatorOutputs.grossContractedRevenue)}
            </p>
          </div>

          <div className="rounded-lg border border-[#313131]/12 bg-[#F6F3EC]/45 p-4">
            <p className="text-xs text-[#313131]/65">
              Receita mensal recorrente adicionada
            </p>
            <p className="mt-1.5 text-xl font-bold text-[#8D6A14] tabular-nums">
              {formatCurrencyBRL(simulatorOutputs.addedMonthlyRecurringRevenue)}
              <span className="text-xs font-medium text-[#313131]/65">
                /mês ({simulatorInputs.averageInstallments}x)
              </span>
            </p>
          </div>

          <div className="rounded-lg border border-[#DCB14A]/50 bg-[#F6F3EC] p-4">
            <p className="text-xs text-[#313131]/75">
              Caixa líquido (descontando inadimplência)
            </p>
            <p className="mt-1.5 text-xl font-bold text-[#313131] tabular-nums">
              {formatCurrencyBRL(simulatorOutputs.netCashAfterDefault)}
            </p>
          </div>

          <div className="rounded-lg border border-[#DCB14A] bg-[#313131] p-4 text-white">
            <p className="text-xs text-[#F6F3EC]/75">
              ROI sobre investimento em Ads
            </p>
            <p className="mt-1.5 text-xl font-bold text-[#FFD559] tabular-nums">
              {simulatorOutputs.projectedRoiPct.toFixed(0)}%{' '}
              <span className="text-xs font-medium text-white/80">
                ({simulatorOutputs.roiMultiple.toFixed(2).replace('.', ',')}x o
                investido)
              </span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
