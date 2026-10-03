import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useHubBalance from '../use-hub-balance';
import { formatBalance } from '../mock-data';
import HubHeroTopBar from '../components/hub-hero-topbar';
import { ChevronRightIcon, MinusIcon, PlusIcon, RefreshIcon, SwapIcon, UsFlagIcon } from '../sidebar/icons';
import './portfolio-section.scss';

const TABS = ['Overview', 'Wallet', 'Partners', 'Trading', 'P2P'] as const;
type TTab = (typeof TABS)[number];

const PortfolioSection = () => {
    const hub = useHubBalance();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<TTab>('Overview');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        hub.refresh();
        window.setTimeout(() => setIsRefreshing(false), 900);
    };

    const balance = hub.selectedView === 'real'
        ? hub.realDemoBalance
        : hub.trickBalance;

    return (
        <div className='hub-portfolio'>
            <div className='hub-portfolio__hero'>
                <HubHeroTopBar />
                <div className='hub-portfolio__tabs'>
                    {TABS.map(tab => (
                        <button
                            key={tab}
                            type='button'
                            className={`hub-portfolio__tab${activeTab === tab ? ' hub-portfolio__tab--active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className='hub-portfolio__value-block'>
                    <span className='hub-portfolio__label'>
                        Est. total value <ChevronRightIcon />
                    </span>
                    <div className='hub-portfolio__value-row'>
                        {isRefreshing ? (
                            <span className='hub-portfolio__spinner' />
                        ) : (
                            <span className='hub-portfolio__amount'>{formatBalance(balance)} USD</span>
                        )}
                        <button type='button' className='hub-portfolio__refresh' onClick={handleRefresh} aria-label='Refresh'>
                            <RefreshIcon />
                        </button>
                    </div>
                    <span className='hub-portfolio__updated'>
                        {isRefreshing ? 'Updating…' : 'Updated 2 min ago'}
                    </span>
                </div>

                <div className='hub-portfolio__actions'>
                    <button type='button' className='hub-portfolio__action'>
                        <span className='hub-portfolio__action-circle hub-portfolio__action-circle--filled'>
                            <PlusIcon />
                        </span>
                        <span className='hub-portfolio__action-label'>Deposit</span>
                    </button>
                    <button type='button' className='hub-portfolio__action' onClick={() => navigate('/dashboard/transfer')}>
                        <span className='hub-portfolio__action-circle'>
                            <SwapIcon />
                        </span>
                        <span className='hub-portfolio__action-label'>Transfer</span>
                    </button>
                    <button type='button' className='hub-portfolio__action'>
                        <span className='hub-portfolio__action-circle'>
                            <MinusIcon />
                        </span>
                        <span className='hub-portfolio__action-label'>Withdraw</span>
                    </button>
                </div>
            </div>

            {(activeTab === 'Overview' || activeTab === 'Wallet') && (
                <section className='hub-portfolio__section'>
                    <h3 className='hub-portfolio__section-title'>Wallet</h3>
                    <div className='hub-portfolio__list'>
                        <div className='hub-portfolio__row'>
                            <div className='hub-portfolio__row-left'>
                                <UsFlagIcon />
                                <span className='hub-portfolio__row-name'>US Dollar</span>
                            </div>
                            <span className='hub-portfolio__row-balance'>
                                {formatBalance(activeTab === 'Wallet' ? balance : 0)} USD
                            </span>
                        </div>
                    </div>
                </section>
            )}

            {(activeTab === 'Overview' || activeTab === 'Partners') && (
                <section className='hub-portfolio__section'>
                    <h3 className='hub-portfolio__section-title'>Partners</h3>
                    <div className='hub-portfolio__list'>
                        <div className='hub-portfolio__row'>
                            <div className='hub-portfolio__row-left'>
                                <UsFlagIcon />
                                <span className='hub-portfolio__row-name'>US Dollar</span>
                            </div>
                            <span className='hub-portfolio__row-balance'>0.00 USD</span>
                        </div>
                    </div>
                </section>
            )}

            {activeTab === 'Trading' && (
                <section className='hub-portfolio__section'>
                    <h3 className='hub-portfolio__section-title'>Open positions</h3>
                    <div className='hub-portfolio__empty'>No open positions</div>
                </section>
            )}

            {activeTab === 'P2P' && (
                <section className='hub-portfolio__section'>
                    <h3 className='hub-portfolio__section-title'>P2P</h3>
                    <div className='hub-portfolio__empty'>No P2P orders</div>
                </section>
            )}
        </div>
    );
};

export default PortfolioSection;
