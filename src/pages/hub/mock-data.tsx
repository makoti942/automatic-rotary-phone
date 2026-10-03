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
};

export const MARKETS: TMarket[] = [
    {
        symbol: 'R_10',
        name: 'Volatility 10 Index',
        price: '1,234.56',
        change: '+0.12%',
        changeColor: '#18A957',
        spark: [30, 35, 32, 40, 38, 45, 42, 48, 44, 50],
        icon: <MarketDerivedVolatility10Icon height={36} width={36} />,
    },
    {
        symbol: 'R_25',
        name: 'Volatility 25 Index',
        price: '2,456.78',
        change: '-0.08%',
        changeColor: '#FF444F',
        spark: [50, 48, 44, 42, 45, 40, 38, 35, 32, 30],
        icon: <MarketDerivedVolatility25Icon height={36} width={36} />,
    },
    {
        symbol: 'R_50',
        name: 'Volatility 50 Index',
        price: '3,678.90',
        change: '+0.21%',
        changeColor: '#18A957',
        spark: [20, 25, 28, 32, 30, 38, 42, 40, 48, 52],
        icon: <MarketDerivedVolatility50Icon height={36} width={36} />,
    },
    {
        symbol: 'R_75',
        name: 'Volatility 75 Index',
        price: '4,891.23',
        change: '+0.15%',
        changeColor: '#18A957',
        spark: [25, 28, 32, 30, 36, 40, 38, 44, 48, 46],
        icon: <MarketDerivedVolatility75Icon height={36} width={36} />,
    },
    {
        symbol: 'R_100',
        name: 'Volatility 100 Index',
        price: '6,123.45',
        change: '-0.05%',
        changeColor: '#FF444F',
        spark: [45, 42, 40, 38, 35, 32, 30, 28, 25, 22],
        icon: <MarketDerivedVolatility100Icon height={36} width={36} />,
    },
    {
        symbol: '1HZ100V',
        name: 'Volatility 100 (1s) Index',
        price: '8,345.67',
        change: '+0.33%',
        changeColor: '#18A957',
        spark: [15, 20, 25, 30, 28, 35, 40, 45, 50, 55],
        icon: <MarketDerivedVolatility1001sIcon height={36} width={36} />,
    },
];

export const PROMO_SLIDES = [
    {
        id: 1,
        title: 'Trade CFDs on SpaceX',
        subtitle: 'Access global markets with competitive spreads',
        cta: 'Trade now',
        gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        accent: '#FF444F',
    },
];

export const MOCK_CFD_ACCOUNTS = [
    { type: 'MT5 Standard', loginid: 'MT51234567', balance: '10,000.00', currency: 'USD', status: 'Active' },
    { type: 'MT5 Advanced', loginid: 'MT5987654', balance: '25,500.00', currency: 'USD', status: 'Active' },
];

export const MOCK_CRYPTO_WALLETS = [
    { type: 'DXN', loginid: 'DXN1234567', balance: '0.0234', currency: 'BTC', status: 'Active' },
    { type: 'USDT', loginid: 'DXN7654321', balance: '1,250.00', currency: 'USDT', status: 'Active' },
];

export const MOCK_POSITIONS = [
    { market: 'Volatility 100 Index', type: 'Rise', stake: '10.00', payout: '19.50', entry: '6,120.30', exit: '6,125.80', profit: '+9.50', status: 'Won' },
    { market: 'Volatility 75 Index', type: 'Fall', stake: '5.00', payout: '9.20', entry: '4,890.10', exit: '4,888.40', profit: '-5.00', status: 'Lost' },
    { market: 'Volatility 50 Index', type: 'Rise', stake: '15.00', payout: '28.80', entry: '3,675.20', exit: '3,679.90', profit: '+13.80', status: 'Won' },
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
