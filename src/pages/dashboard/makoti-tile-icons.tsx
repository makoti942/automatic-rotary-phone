import React from 'react';

type TIconProps = {
    size?: number;
    className?: string;
};

/** Laptop + upload arrow — My Computer / Local tile */
export const MyComputerIcon = ({ size = 72, className = '' }: TIconProps) => (
    <svg
        className={className}
        width={size}
        height={size}
        viewBox='0 0 72 72'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
    >
        <path
            d='M14 48h44l4 8H10l4-8z'
            fill='rgba(255,255,255,0.22)'
            stroke='#fff'
            strokeWidth='2.2'
            strokeLinejoin='round'
        />
        <rect
            x='16'
            y='18'
            width='40'
            height='30'
            rx='3'
            fill='rgba(255,255,255,0.12)'
            stroke='#fff'
            strokeWidth='2.2'
        />
        <rect x='20' y='22' width='32' height='22' rx='2' fill='rgba(255,255,255,0.08)' />
        <circle cx='36' cy='33' r='9' fill='#fff' fillOpacity='0.95' />
        <path
            d='M36 28.5v9M32.5 32.5L36 29l3.5 3.5'
            stroke='#1e3a8a'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

/** Robot face — Bot Builder tile */
export const BotBuilderIcon = ({ size = 72, className = '' }: TIconProps) => (
    <svg
        className={className}
        width={size}
        height={size}
        viewBox='0 0 72 72'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
    >
        <line x1='36' y1='10' x2='36' y2='18' stroke='#fff' strokeWidth='2.4' strokeLinecap='round' />
        <circle cx='36' cy='8' r='3.2' fill='#fff' />
        <rect
            x='16'
            y='18'
            width='40'
            height='34'
            rx='12'
            fill='rgba(255,255,255,0.16)'
            stroke='#fff'
            strokeWidth='2.4'
        />
        <rect x='10' y='30' width='6' height='12' rx='2.5' fill='#fff' fillOpacity='0.9' />
        <rect x='56' y='30' width='6' height='12' rx='2.5' fill='#fff' fillOpacity='0.9' />
        <circle cx='28' cy='34' r='5' fill='#fff' />
        <circle cx='44' cy='34' r='5' fill='#fff' />
        <circle cx='29.5' cy='34.5' r='2' fill='#065f46' />
        <circle cx='45.5' cy='34.5' r='2' fill='#065f46' />
        <path d='M28 44c2.5 3 13.5 3 16 0' stroke='#fff' strokeWidth='2.2' strokeLinecap='round' />
        <rect x='30' y='52' width='12' height='6' rx='2' fill='rgba(255,255,255,0.55)' />
        <rect x='22' y='58' width='28' height='6' rx='3' fill='rgba(255,255,255,0.35)' />
    </svg>
);

/** Puzzle pieces — Quick Strategy tile */
export const QuickStrategyIcon = ({ size = 72, className = '' }: TIconProps) => (
    <svg
        className={className}
        width={size}
        height={size}
        viewBox='0 0 72 72'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
    >
        <path
            d='M28 16h14a6 6 0 016 6v4h4a6 6 0 016 6v14H52a6 6 0 00-6 6v4H32a6 6 0 01-6-6v-4h-4a6 6 0 01-6-6V26h4a6 6 0 006-6v-4z'
            fill='rgba(255,255,255,0.18)'
            stroke='#fff'
            strokeWidth='2'
            strokeLinejoin='round'
            transform='translate(4 6)'
        />
        <path
            d='M22 14h12a5 5 0 015 5v3h3a5 5 0 015 5v12H43a5 5 0 00-5 5v3H26a5 5 0 01-5-5v-3h-3a5 5 0 01-5-5V24h3a5 5 0 005-5v-5z'
            fill='rgba(255,255,255,0.88)'
            stroke='#fff'
            strokeWidth='1.6'
            strokeLinejoin='round'
        />
        <circle cx='34' cy='19' r='2.2' fill='#a855f7' />
        <circle cx='48' cy='28' r='2.2' fill='#a855f7' />
    </svg>
);

/** Google Drive tile icon */
export const GoogleDriveTileIcon = ({ size = 72, className = '' }: TIconProps) => (
    <svg
        className={className}
        width={size}
        height={size}
        viewBox='0 0 72 72'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
    >
        <path
            d='M24 16h24l14 24H38L24 16z'
            fill='rgba(255,255,255,0.2)'
            stroke='#fff'
            strokeWidth='2'
            strokeLinejoin='round'
        />
        <path
            d='M24 40l7 12h22l7-12H24z'
            fill='rgba(255,255,255,0.35)'
            stroke='#fff'
            strokeWidth='2'
            strokeLinejoin='round'
        />
        <path
            d='M17 40h14l-7 12H10l7-12z'
            fill='rgba(255,255,255,0.28)'
            stroke='#fff'
            strokeWidth='2'
            strokeLinejoin='round'
        />
    </svg>
);

export default {
    MyComputerIcon,
    BotBuilderIcon,
    QuickStrategyIcon,
    GoogleDriveTileIcon,
};
