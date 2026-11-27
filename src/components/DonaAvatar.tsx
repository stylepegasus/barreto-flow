import React, { useState } from 'react';
import { ASSISTANT_NAME } from '../utils/assistantContext';

export type DonaAvatarSize = 'xs' | 'sm' | 'md' | 'lg';

interface DonaAvatarProps {
  size?: DonaAvatarSize;
  decorative?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<DonaAvatarSize, string> = {
  xs: 'h-4 w-4 ring-1',
  sm: 'h-9 w-9 ring-[1.5px]',
  md: 'h-10 w-10 ring-[1.5px]',
  lg: 'h-12 w-12 ring-2',
};

const DONA_AVATAR_SRC = '/assets/dona-avatar-v1.jpg';

/**
 * Fallback SVG ilustrado em estética editorial (mulher ruiva executiva na paleta
 * Grafite #313131, Marfim #F6F3EC e Dourado #DCB14A), exibido apenas se o asset falhar.
 */
function DonaExecutiveFallbackSvg() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect width="64" height="64" fill="#2E2D2B" />
      {/* Ondas do cabelo ruivo acobreado (plano traseiro) */}
      <path
        d="M17 31C16 20 22 11 32 11C42 11 48 20 47 31C48 37 47 43 43 47H21C17 43 16 37 17 31Z"
        fill="#A4421F"
      />
      {/* Blazer grafite e blusa marfim */}
      <path d="M11 64C12 52 19 46 32 46C45 46 52 52 53 64H11Z" fill="#313131" />
      <path d="M26 46L32 58L38 46H26Z" fill="#F6F3EC" />
      {/* Detalhe dourado discreto na lapela */}
      <ellipse cx="40.5" cy="54.5" rx="2.4" ry="1.1" transform="rotate(-18 40.5 54.5)" fill="#DCB14A" />
      {/* Pescoço e rosto */}
      <rect x="28" y="39" width="8" height="9" rx="3" fill="#EDC7B0" />
      <ellipse cx="32" cy="29" rx="10.5" ry="12.5" fill="#F2D1BC" />
      {/* Franja e lateral ruiva acobreada */}
      <path
        d="M21 28C21 19 26 14 33 14C39 14 43 18 43 26C40 21 36 19 31 19C26 19 23 23 21 28Z"
        fill="#C4572A"
      />
      {/* Traços sutis */}
      <circle cx="28.2" cy="28.5" r="1.2" fill="#313131" />
      <circle cx="35.8" cy="28.5" r="1.2" fill="#313131" />
      <path
        d="M28.5 34.5C30.3 36 33.7 36 35.5 34.5"
        stroke="#9A513E"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Brinco dourado sutil */}
      <circle cx="42.5" cy="31.5" r="1.4" fill="#DCB14A" />
    </svg>
  );
}

export const DonaAvatar: React.FC<DonaAvatarProps> = ({
  size = 'md',
  decorative = false,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <span
      data-testid={`dona-avatar-${size}`}
      aria-hidden={decorative ? 'true' : undefined}
      className={`relative inline-flex shrink-0 overflow-hidden rounded-full bg-[#313131] ring-[#DCB14A]/75 shadow-sm ${SIZE_CLASSES[size]} ${className}`}
    >
      {!imgFailed ? (
        <img
          src={DONA_AVATAR_SRC}
          alt={
            decorative
              ? ''
              : `${ASSISTANT_NAME} — Assistente executiva do Barreto Flow`
          }
          loading="eager"
          decoding="async"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-top select-none"
        />
      ) : (
        <DonaExecutiveFallbackSvg />
      )}
    </span>
  );
};
