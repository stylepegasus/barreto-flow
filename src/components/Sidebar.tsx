import React from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Target,
  Settings,
  X,
  LogOut,
} from 'lucide-react';
import { ActiveTab, DataSourceMode } from '../types/honorarios';
import { BrandMark } from './BrandMark';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  sourceMode: DataSourceMode;
  readOnlyMode: boolean;
  googleUserEmail: string | null;
  onGoogleSignOut: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'calendario', label: 'Calendário de Cobranças', icon: CalendarDays },
  { id: 'clientes', label: 'Clientes & Processos', icon: Users },
  { id: 'metas', label: 'Metas & Projeções', icon: Target },
  { id: 'configuracoes', label: 'Configurações & Conexão Google', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  sourceMode,
  readOnlyMode,
  googleUserEmail,
  onGoogleSignOut,
  mobileOpen,
  onCloseMobile,
}) => {
  const sourceLabel =
    sourceMode === 'apps_script' || sourceMode === 'google_workspace'
      ? readOnlyMode
        ? 'Planilha Real (Somente Leitura)'
        : sourceMode === 'apps_script'
          ? 'Planilha Real (Apps Script)'
          : 'Google Workspace ativo'
      : 'Base de demonstração';

  const navContent = (
    <div className="flex h-full flex-col justify-between bg-[#313131] text-[#F6F3EC] px-5 py-7">
      <div>
        <div className="flex items-start justify-between border-b border-white/15 pb-6">
          <div className="flex items-center gap-3.5">
            <BrandMark size="md" />
            <div>
              <p className="font-serif text-lg font-bold tracking-tight text-[#FFFFFF] leading-tight">
                Barreto
              </p>
              <p className="mt-0.5 text-xs font-medium tracking-wide text-[#DCB14A]">
                Advocacia Especializada
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fechar menu"
            className="rounded-md p-1.5 text-white/75 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Navegação principal" className="mt-7 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#FFD559] ${
                  isActive
                    ? 'bg-[#DCB14A]/18 text-[#FFD559] ring-1 ring-inset ring-[#DCB14A]/40'
                    : 'text-[#F6F3EC]/80 hover:bg-white/8 hover:text-[#FFFFFF]'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-[#FFD559]' : 'text-[#F6F3EC]/65'
                  }`}
                />
                <span className="leading-snug">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-4 border-t border-white/15 pt-5">
        <p className="font-serif text-[11px] italic leading-relaxed text-[#F6F3EC]/70">
          Compromisso com o Direito. Excelência no Resultado.
        </p>

        <div
          className="border-t border-white/10 pt-3"
          aria-label={`Origem dos dados: ${sourceLabel}`}
        >
          <p className="text-[11px] font-medium text-[#F6F3EC]/55">
            Origem dos dados:
          </p>
          <p
            className="mt-0.5 text-xs font-medium text-[#DCB14A]"
            data-testid="sidebar-source-badge"
          >
            {sourceLabel}
          </p>
        </div>

        {googleUserEmail && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] text-[#F6F3EC]/55">Conta Google</p>
              <p className="truncate text-xs text-white/95">{googleUserEmail}</p>
            </div>
            <button
              type="button"
              onClick={onGoogleSignOut}
              aria-label="Sair da conta Google"
              title="Sair da conta Google"
              className="shrink-0 rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block lg:w-[276px] lg:shrink-0 border-r border-[#313131]/15">
        <div className="sticky top-0 h-screen">{navContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
        >
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 w-[276px] max-w-[85vw] h-full shadow-2xl">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};
