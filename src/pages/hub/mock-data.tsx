import {
    MarketDerivedVolatility10Icon,
    MarketDerivedVolatility25Icon,
    MarketDerivedVolatility50Icon,
    MarketDerivedVolatility75Icon,
    MarketDerivedVolatility100Icon,
    MarketDerivedVolatility1001sIcon,
} from '@deriv/quill-icons/Markets';

export type TMarket = {
    symbol: string;
    name: string;
    price: string;
    change: string;
    changeColor: string;
    spark: number[];
    icon: React.ReactNode;
    badge: string;
};

export const MARKETS: TMarket[] = [
    {
        symbol: 'R_100',
        name: 'Volatility 100 (1s) Index',
        price: '1,034.31',
        change: '+0.56%',
        changeColor: '#18A957',
        spark: [30, 35, 32, 40, 38, 45, 42, 48, 44, 50],
        icon: <MarketDerivedVolatility1001sIcon height={32} width={32} />,
        badge: '100',
    },
    {
        symbol: 'R_75',
        name: 'Volatility 75 (1s) Index',
        price: '5,069.24',
        change: '+0.12%',
        changeColor: '#18A957',
        spark: [50, 48, 44, 42, 45, 40, 38, 35, 32, 30],
        icon: <MarketDerivedVolatility75Icon height={32} width={32} />,
        badge: '75',
    },
    {
        symbol: 'R_25',
        name: 'Volatility 25 (1s) Index',
        price: '854,246.60',
        change: '+0.05%',
        changeColor: '#18A957',
        spark: [20, 25, 28, 32, 30, 38, 42, 40, 48, 52],
        icon: <MarketDerivedVolatility25Icon height={32} width={32} />,
        badge: '25',
    },
    {
        symbol: 'R_50',
        name: 'Volatility 50 (1s) Index',
        price: '183,565.42',
        change: '+0.17%',
        changeColor: '#18A957',
        spark: [25, 28, 32, 30, 36, 40, 38, 44, 48, 46],
        icon: <MarketDerivedVolatility50Icon height={32} width={32} />,
        badge: '50',
    },
    {
        symbol: 'R_10',
        name: 'Volatility 10 (1s) Index',
        price: '9,035.57',
        change: '+0.08%',
        changeColor: '#18A957',
        spark: [45, 42, 40, 38, 35, 32, 30, 28, 25, 22],
        icon: <MarketDerivedVolatility10Icon height={32} width={32} />,
        badge: '10',
    },
    {
        symbol: 'R_100x',
        name: 'Volatility 100 Index',
        price: '6,123.45',
        change: '-0.05%',
        changeColor: '#FF444F',
        spark: [15, 20, 25, 30, 28, 35, 40, 45, 50, 55],
        icon: <MarketDerivedVolatility100Icon height={32} width={32} />,
        badge: '100',
    },
];

export const PROMO_SLIDES = [
    {
        id: 1,
        title: 'SpaceX CFDs',
        subtitle: 'Trade the space giant with competitive leverage.',
        cta: 'Trade now',
        gradient: 'linear-gradient(135deg, #1a1d2e 0%, #151829 100%)',
        accent: '#FF444F',
    },
];

export const PLATFORMS = [
    { code: 'DT', name: 'Deriv Trader', desc: 'Trade options on 100+ markets. No overnight swap fees.', color: '#FF444F' },
    { code: 'DB', name: 'Deriv Bot', desc: 'Build and run automated bots, no coding needed.', color: '#FF444F' },
    { code: 'ST', name: 'SmartTrader', desc: 'Classic interface for advanced options traders.', color: '#1e3a5f' },
];

export const TRADE_TYPES = [
    { name: 'Rise/Fall' },
    { name: 'Higher/Lower' },
    { name: 'Matches/Differs' },
    { name: 'Even/Odd' },
    { name: 'Accumulators' },
    { name: 'Over/Under' },
    { name: 'Multipliers' },
    { name: 'Touch/No Touch' },
    { name: 'Vanillas' },
    { name: 'Turbos' },
];

export const MOCK_CFD_ACCOUNTS = [
    { type: 'CFDs | Standard', loginid: 'MT51234567', balance: '10,000.00', currency: 'USD', status: 'Active' },
];

export const MOCK_CRYPTO_WALLETS = [
    { type: 'Crypto', loginid: 'DXN1234567', balance: '0.0234', currency: 'USDT', status: 'Active' },
];

export const MOCK_POSITIONS = [
    { market: 'Volatility 100 (1s) Index', type: 'Rise', stake: '10.00', payout: '19.50', entry: '1,030.20', exit: '1,034.31', profit: '+9.50', status: 'Won' },
    { market: 'Volatility 75 (1s) Index', type: 'Fall', stake: '5.00', payout: '9.20', entry: '5,072.10', exit: '5,069.24', profit: '-5.00', status: 'Lost' },
];

export const NAV_ITEMS = [
    { path: '/dashboard/home', label: 'Home', key: 'home' },
    { path: '/dashboard/cfds', label: 'CFDs', key: 'cfds' },
    { path: '/dashboard/crypto', label: 'Crypto', key: 'crypto' },
    { path: '/dashboard/options', label: 'Options', key: 'options' },
    { path: '/dashboard/portfolio', label: 'Portfolio', key: 'portfolio' },
];

export const formatBalance = (value: number, decimals: number = 2): string => {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
};

export const generateSparkline = (points: number[], width: number = 80, height: number = 30): string => {
    if (!points.length) return '';
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = width / (points.length - 1);
    return points
        .map((p, i) => {
            const x = i * step;
            const y = height - ((p - min) / range) * height;
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
};
