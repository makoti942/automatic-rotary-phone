import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatBalance } from '../mock-data';
import { BellIcon, EyeIcon, RefreshIcon } from '../sidebar/icons';
import './total-value-card.scss';

type TTotalValueCardProps = {
    totalValue: number;
    currency: string;
    selectedView?: 'real' | 'demo';
    onSelectView?: (view: 'real' | 'demo') => void;
    onReset?: () => void;
    onTransfer?: () => void;
    onRefresh?: () => void;
    variant?: 'home' | 'options';
};

const ChevronIcon = () => (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <polyline points='9 18 15 12 9 6' />
    </svg>
);

const CandleIcon = () => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <line x1='6' y1='4' x2='6' y2='8' />
        <line x1='6' y1='16' x2='6' y2='20' />
        <rect x='4' y='8' width='4' height='8' rx='1' />
        <line x1='12' y1='2' x2='12' y2='6' />
        <line x1='12' y1='14' x2='12' y2='22' />
        <rect x='10' y='6' width='4' height='8' rx='1' />
        <line x1='18' y1='6' x2='18' y2='10' />
        <line x1='18' y1='18' x2='18' y2='20' />
        <rect x='16' y='10' width='4' height='8' rx='1' />
    </svg>
);

const TransferIconSvg = () => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
        <polyline points='17 1 21 5 17 9' />
        <path d='M3 11V9a4 4 0 014-4h14' />
        <polyline points='7 23 3 19 7 15' />
        <path d='M21 13v2a4 4 0 01-4 4H3' />
    </svg>
);

const TotalValueCard = ({
    totalValue,
    currency,
    selectedView,
    onSelectView,
    onReset,
    onTransfer,
    onRefresh,
    variant = 'home',
}: TTotalValueCardProps) => {
    const view = selectedView ?? 'demo';
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        onRefresh?.();
        window.setTimeout(() => setIsRefreshing(false), 900);
    };

    if (variant === 'home') {
        return (
            <div className='total-value-card total-value-card--home'>
                <div className='total-value-card__top-row'>
                    <div className='total-value-card__left'>
                        <span className='total-value-card__label'>
                            Total value <ChevronIcon />
                        </span>
                        <div className='total-value-card__value-row'>
                            {isRefreshing ? (
                                <span className='total-value-card__loading'>
                                    <span className='total-value-card__spinner' />
                                </span>
                            ) : (
                                <span className='total-value-card__amount'>{formatBalance(totalValue)} USD</span>
                            )}
                            <button type='button' className='total-value-card__refresh' onClick={handleRefresh} aria-label='Refresh balance'>
                                <RefreshIcon />
                            </button>
                        </div>
                        <span className='total-value-card__updated'>
                            {isRefreshing ? 'Updating…' : 'Updated just now'}
                        </span>
                    </div>
                    <div className='total-value-card__right'>
                        <span className='total-value-card__icon-btn'><EyeIcon /></span>
                        <button type='button' className='total-value-card__deposit'>Deposit</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className='total-value-card total-value-card--options'>
            <div className='total-value-card__toggle-row'>
                <div className='total-value-card__toggle'>
                    <button
                        type='button'
                        className={`total-value-card__toggle-btn${view === 'real' ? ' total-value-card__toggle-btn--active' : ''}`}
                        onClick={() => onSelectView?.('real')}
                    >
                        Real
                    </button>
                    <button
                        type='button'
                        className={`total-value-card__toggle-btn${view === 'demo' ? ' total-value-card__toggle-btn--active' : ''}`}
                        onClick={() => onSelectView?.('demo')}
                    >
                        Demo
                    </button>
                </div>
                <div className='total-value-card__toggle-icons'>
                    {view === 'real' && (
                        <span className='total-value-card__icon-btn'><EyeIcon /></span>
                    )}
                    <span className='total-value-card__icon-btn'><BellIcon /></span>
                </div>
            </div>
            <div className='total-value-card__options-body'>
                <div className='total-value-card__options-left'>
                    <span className='total-value-card__label'>Total trading value</span>
                    <div className='total-value-card__value-row'>
                        {isRefreshing ? (
                            <span className='total-value-card__loading'>
                                <span className='total-value-card__spinner' />
                            </span>
                        ) : (
                            <span className='total-value-card__amount'>{formatBalance(totalValue)} USD</span>
                        )}
                        <button type='button' className='total-value-card__refresh' onClick={handleRefresh} aria-label='Refresh balance'>
                            <RefreshIcon />
                        </button>
                    </div>
                    <span className='total-value-card__updated'>
                        {isRefreshing ? 'Updating…' : 'Updated just now'}
                    </span>
                </div>
                <div className='total-value-card__options-actions'>
                    <button type='button' className='total-value-card__action-btn'>
                        <span className='total-value-card__action-circle total-value-card__action-circle--trade'>
                            <CandleIcon />
                        </span>
                        <span className='total-value-card__action-label'>Trade</span>
                    </button>
                    {view === 'real' ? (
                        <button type='button' className='total-value-card__action-btn' onClick={onTransfer}>
                            <span className='total-value-card__action-circle total-value-card__action-circle--outline'>
                                <TransferIconSvg />
                            </span>
                            <span className='total-value-card__action-label'>Transfer</span>
                        </button>
                    ) : (
                        <button type='button' className='total-value-card__action-btn' onClick={onReset}>
                            <span className='total-value-card__action-circle total-value-card__action-circle--outline'>
                                <RefreshIcon />
                            </span>
                            <span className='total-value-card__action-label'>Reset balance</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TotalValueCard;
