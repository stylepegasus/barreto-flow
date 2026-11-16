import React from 'react';

interface BrandMarkProps {
  size?: 'sm' | 'md';
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 'md' }) => {
  const dimension = size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';

  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`${dimension} shrink-0`}
    >
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="2.5"
        fill="#313131"
        stroke="#DCB14A"
        strokeWidth="1.75"
      />
      <rect
        x="4.5"
        y="4.5"
        width="39"
        height="39"
        rx="1"
        stroke="#DCB14A"
        strokeOpacity="0.45"
        strokeWidth="0.75"
      />
      <text
        x="24"
        y="32.5"
        textAnchor="middle"
        fill="#DCB14A"
        fontFamily="'Libre Baskerville', Georgia, serif"
        fontWeight="700"
        fontSize="24"
      >
        B
      </text>
    </svg>
  );
};
