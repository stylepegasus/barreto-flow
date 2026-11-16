import React from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Cancelar',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[#313131]/15 bg-[#F6F3EC] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h3
            id="confirm-dialog-title"
            className="font-serif text-lg font-bold text-[#313131]"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Fechar confirmação"
            className="rounded-md p-1 text-[#313131]/55 hover:bg-[#313131]/5 hover:text-[#313131]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[#313131]/80">
          {description}
        </p>

        {details && details.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-lg border border-[#313131]/12 bg-white px-4 py-3 text-xs text-[#313131]/85">
            {details.map((line, i) => (
              <li key={i} className="leading-relaxed">
                {line}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-[#313131]/20 bg-white px-4 py-2 text-sm font-medium text-[#313131] hover:bg-[#313131]/5 whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-[#313131] px-4 py-2 text-sm font-medium text-[#FFFFFF] hover:bg-[#313131]/90 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {busy ? 'Salvando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
