import { BrandDerivWordmarkCoralIcon } from '@deriv/quill-icons/Logo';
import {
    LegacyHomeNewIcon,
    LegacyTradeTypeCfdsIcon,
    LegacyMarketCryptocurrenciesIcon,
    LegacyTradeTypeOptionsIcon,
    LegacyWalletIcon,
} from '@deriv/quill-icons/Legacy';

export const DerivLogo = () => (
    <span className='hub-sidebar__logo'>
        <BrandDerivWordmarkCoralIcon height={28} width={84} />
    </span>
);

export const HomeIcon = () => <LegacyHomeNewIcon iconSize='md' />;

export const CfdsIcon = () => <LegacyTradeTypeCfdsIcon iconSize='md' />;

export const CryptoIcon = () => <LegacyMarketCryptocurrenciesIcon iconSize='md' />;

export const OptionsIcon = () => <LegacyTradeTypeOptionsIcon iconSize='md' />;

export const PortfolioIcon = () => <LegacyWalletIcon iconSize='md' />;

export const AskAmyIcon = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor'>
        <path d='M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z' />
    </svg>
);

export const QrCodeIcon = () => (
    <svg width='64' height='64' viewBox='0 0 64 64' fill='currentColor'>
        <rect x='4' y='4' width='22' height='22' rx='3' fill='none' stroke='currentColor' strokeWidth='4' />
        <rect x='10' y='10' width='10' height='10' rx='1' />
        <rect x='38' y='4' width='22' height='22' rx='3' fill='none' stroke='currentColor' strokeWidth='4' />
        <rect x='44' y='10' width='10' height='10' rx='1' />
        <rect x='4' y='38' width='22' height='22' rx='3' fill='none' stroke='currentColor' strokeWidth='4' />
        <rect x='10' y='44' width='10' height='10' rx='1' />
        <rect x='38' y='38' width='6' height='6' />
        <rect x='50' y='38' width='6' height='6' />
        <rect x='44' y='44' width='6' height='6' />
        <rect x='38' y='50' width='6' height='6' />
        <rect x='50' y='50' width='6' height='6' />
        <rect x='56' y='44' width='4' height='4' />
        <rect x='44' y='56' width='4' height='4' />
    </svg>
);

export const TransferIcon = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <polyline points='17 1 21 5 17 9' />
        <path d='M3 11V9a4 4 0 014-4h14' />
        <polyline points='7 23 3 19 7 15' />
        <path d='M21 13v2a4 4 0 01-4 4H3' />
    </svg>
);

export const TradeIcon = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <polyline points='23 6 13.5 15.5 8.5 10.5 1 18' />
        <polyline points='17 6 23 6 23 12' />
    </svg>
);

export const ResetIcon = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <polyline points='1 4 1 10 7 10' />
        <path d='M3.51 15a9 9 0 102.13-9.36L1 10' />
    </svg>
);
