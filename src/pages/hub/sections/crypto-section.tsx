import { useState } from 'react';
import useHubBalance from '../use-hub-balance';
import { formatBalance } from '../mock-data';
import HubHeroTopBar from '../components/hub-hero-topbar';
import { BtcIcon, ChevronDownIcon, ChevronRightIcon, EthIcon, LtcIcon, PlusIcon, RefreshIcon, SendIcon, UsdcIcon, UsdtIcon } from '../sidebar/icons';
import './crypto-section.scss';

const COINS = [
    { key: 'ETH', label: 'ETH' },
    { key: 'BTC', label: 'BTC' },
    { key: 'USDC', label: 'USDC' },
    { key: 'USDT', label: 'USDT' },
];

const COIN_ICONS: Record<string, React.ReactNode> = {
    ETH: <EthIcon size={32} />,
    BTC: <BtcIcon size={32} />,
    USDC: <UsdcIcon size={32} />,
    USDT: <UsdtIcon size={32} />,
    LTC: <LtcIcon size={32} />,
};

const MARKET_ROWS = [
    { pair: 'LTC/ETH', icon: 'LTC', price: '0.02603', change: '0.77%', up: true },
    { pair: 'BTC/ETH', icon: 'BTC', price: '19.842', change: '0.31%', up: true },
    { pair: 'ETH/USDT', icon: 'ETH', price: '3,241.50', change: '1.24%', up: true },
];

const SPOT_BALANCES = [
    { label: 'ETH Spot balance', icon: 'ETH', amount: '0.00000000' },
    { label: 'BTC Spot balance', icon: 'BTC', amount: '0.00000000' },
];

const CryptoSection = () => {
    const hub = useHubBalance();
    const [activeCoin, setActiveCoin] = useState('ETH');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        hub.refresh();
        window.setTimeout(() => setIsRefreshing(false), 900);
    };

    const balance = hub.isSandboxActive && hub.sandboxBalance > 0
        ? hub.sandboxBalance
        : hub.trickBalance;

    return (
        <div className='hub-crypto'>
            <div className='hub-crypto__hero'>
                <HubHeroTopBar />
                <div className='hub-crypto__value-block'>
                    <span className='hub-crypto__label'>
                        Est. total value <ChevronRightIcon />
                    </span>
                    <div className='hub-crypto__value-row'>
                        {isRefreshing ? (
                            <span className='hub-crypto__spinner' />
                        ) : (
                            <span className='hub-crypto__amount'>{formatBalance(balance)} USDT</span>
                        )}
                        <button type='button' className='hub-crypto__refresh' onClick={handleRefresh} aria-label='Refresh'>
                            <RefreshIcon />
                        </button>
                    </div>
                    <span className='hub-crypto__updated'>
                        {isRefreshing ? 'Updating…' : 'Updated just now'}
                    </span>
                </div>

                <div className='hub-crypto__actions'>
                    <button type='button' className='hub-crypto__action'>
                        <span className='hub-crypto__action-circle hub-crypto__action-circle--filled'>
                            <PlusIcon />
                        </span>
                        <span className='hub-crypto__action-label'>Add funds</span>
                    </button>
                    <button type='button' className='hub-crypto__action'>
                        <span className='hub-crypto__action-circle'>
                            <SendIcon />
                        </span>
                        <span className='hub-crypto__action-label'>Send</span>
                    </button>
                </div>
            </div>

            <section className='hub-crypto__section'>
                <h3 className='hub-crypto__section-title'>Trade crypto</h3>
                <div className='hub-crypto__panel'>
                    <div className='hub-crypto__coin-tabs'>
                        {COINS.map(coin => (
                            <button
                                key={coin.key}
                                type='button'
                                className={`hub-crypto__coin-tab${activeCoin === coin.key ? ' hub-crypto__coin-tab--active' : ''}`}
                                onClick={() => setActiveCoin(coin.key)}
                            >
                                {coin.label}
                            </button>
                        ))}
                    </div>

                    <div className='hub-crypto__market-list'>
                        {MARKET_ROWS.map(row => (
                            <button key={row.pair} type='button' className='hub-crypto__market-row'>
                                <div className='hub-crypto__market-left'>
                                    <span className='hub-crypto__market-icon'>{COIN_ICONS[row.icon]}</span>
                                    <div className='hub-crypto__market-info'>
                                        <span className='hub-crypto__market-pair'>{row.pair}</span>
                                        <span className='hub-crypto__market-price'>
                                            {row.price} ({row.change})
                                            <span className={`hub-crypto__market-arrow${row.up ? ' hub-crypto__market-arrow--up' : ''}`}>▲</span>
                                        </span>
                                    </div>
                                </div>
                                <ChevronDownIcon />
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section className='hub-crypto__section'>
                <h3 className='hub-crypto__section-title'>Spot balances</h3>
                <div className='hub-crypto__spot-list'>
                    {SPOT_BALANCES.map(spot => (
                        <div key={spot.label} className='hub-crypto__spot-row'>
                            <div className='hub-crypto__spot-left'>
                                <span className='hub-crypto__spot-icon'>{COIN_ICONS[spot.icon]}</span>
                                <span className='hub-crypto__spot-label'>{spot.label}</span>
                            </div>
                            <span className='hub-crypto__spot-amount'>{spot.amount}</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default CryptoSection;
