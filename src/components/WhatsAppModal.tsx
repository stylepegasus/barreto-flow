import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, X } from 'lucide-react';
import { InstallmentWithStatus } from '../types/honorarios';
import {
  buildWhatsAppLink,
  buildWhatsAppMessage,
  formatCurrencyBRL,
  formatDateBR,
} from '../utils/honorariosLogic';

interface WhatsAppModalProps {
  item: InstallmentWithStatus | null;
  onClose: () => void;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  item,
  onClose,
}) => {
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (item) {
      setMessage(
        buildWhatsAppMessage(
          item.clientName,
          item.installmentNumber,
          item.totalInstallments,
          item.amount,
          item.dueDate,
          item.status === 'Atrasada'
        )
      );
      setCopied(false);
    }
  }, [item]);

  if (!item) return null;

  const waUrl = buildWhatsAppLink(item.clientPhone, message);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in restricted headless context; no-op
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#313131]/15 bg-[#F6F3EC] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="whatsapp-modal-title"
              className="font-serif text-lg font-bold text-[#313131]"
            >
              Mensagem de Cobrança — WhatsApp
            </h3>
            <p className="mt-1 text-xs text-[#313131]/65 tabular-nums">
              {item.clientName} · Parcela {item.installmentNumber}/
              {item.totalInstallments} · {formatCurrencyBRL(item.amount)} · Venc.{' '}
              {formatDateBR(item.dueDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de WhatsApp"
            className="rounded-md p-1 text-[#313131]/55 hover:bg-[#313131]/5 hover:text-[#313131]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <label
            htmlFor="whatsapp-message-text"
            className="block text-xs font-medium text-[#313131]/80"
          >
            Texto pronto para envio (você pode ajustar antes de enviar)
          </label>
          <textarea
            id="whatsapp-message-text"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-2 w-full rounded-lg border border-[#313131]/20 bg-white p-3.5 text-sm leading-relaxed text-[#313131] focus:border-[#DCB14A] focus:outline-none"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-lg border border-[#313131]/20 bg-white px-4 py-2 text-sm font-medium text-[#313131] hover:bg-[#313131]/5 whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-700" />
                Texto Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 text-[#313131]/65" />
                Copiar Mensagem
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[#313131]/75 hover:bg-[#313131]/5 whitespace-nowrap shrink-0"
            >
              Fechar
            </button>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#313131] px-4 py-2 text-sm font-medium text-[#FFFFFF] hover:bg-[#313131]/90 whitespace-nowrap shrink-0"
            >
              <MessageCircle className="h-4 w-4 text-[#FFD559]" />
              Abrir no WhatsApp
              <ExternalLink className="h-3.5 w-3.5 opacity-75" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
