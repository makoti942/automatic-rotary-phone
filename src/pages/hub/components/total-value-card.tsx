import { formatBalance } from '../mock-data';
import './total-value-card.scss';

type TTotalValueCardProps = {
    totalValue: number;
    currency: string;
    selectedView?: 'real' | 'demo';
    onSelectView?: (view: 'real' | 'demo') => void;
    onReset?: () => void;
    variant?: 'home' | 'options';
};

const EyeIcon = () => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
        <circle cx='12' cy='12' r='3' />
    </svg>
);

const RefreshIcon = () => (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <polyline points='23 4 23 10 17 10' />
        <path d='M20.49 15a9 9 0 11-2.12-9.36L23 10' />
    </svg>
);

const ChevronIcon = () => (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <polyline points='9 18 15 12 9 6' />
    </svg>
);

const CandleIcon = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
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

const TotalValueCard = ({
    totalValue,
    currency,
    selectedView,
    onSelectView,
    onReset,
    variant = 'home',
}: TTotalValueCardProps) => {
    if (variant === 'home') {
        return (
            <div className='total-value-card total-value-card--home'>
                <div className='total-value-card__top-row'>
                    <div className='total-value-card__left'>
                        <span className='total-value-card__label'>
                            Total value <ChevronIcon />
                        </span>
                        <div className='total-value-card__value-row'>
                            <span className='total-value-card__amount'>{formatBalance(totalValue)} USD</span>
                            <span className='total-value-card__refresh'><RefreshIcon /></span>
                        </div>
                        <span className='total-value-card__updated'>Updated just now</span>
                    </div>
                    <div className='total-value-card__right'>
                        <span className='total-value-card__eye'><EyeIcon /></span>
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
                        className={`total-value-card__toggle-btn${selectedView === 'real' ? ' total-value-card__toggle-btn--active' : ''}`}
                        onClick={() => onSelectView?.('real')}
                    >
                        Real
                    </button>
                    <button
                        type='button'
                        className={`total-value-card__toggle-btn${selectedView === 'demo' ? ' total-value-card__toggle-btn--active' : ''}`}
                        onClick={() => onSelectView?.('demo')}
                    >
                        Demo
                    </button>
                </div>
                <div className='total-value-card__toggle-icons'>
                    <span className='total-value-card__eye'><EyeIcon /></span>
                </div>
            </div>
            <div className='total-value-card__options-body'>
                <div className='total-value-card__options-left'>
                    <span className='total-value-card__label'>Total trading value</span>
                    <div className='total-value-card__value-row'>
                        <span className='total-value-card__amount'>{formatBalance(totalValue)} USD</span>
                        <span className='total-value-card__refresh'><RefreshIcon /></span>
                    </div>
                    <span className='total-value-card__updated'>Updated just now</span>
                </div>
                <div className='total-value-card__options-actions'>
                    <button type='button' className='total-value-card__action-btn total-value-card__action-btn--trade'>
                        <span className='total-value-card__action-circle total-value-card__action-circle--trade'>
                            <CandleIcon />
                        </span>
                        <span className='total-value-card__action-label'>Trade</span>
                    </button>
                    <button type='button' className='total-value-card__action-btn total-value-card__action-btn--reset' onClick={onReset}>
                        <span className='total-value-card__action-circle total-value-card__action-circle--reset'>
                            <RefreshIcon />
                        </span>
                        <span className='total-value-card__action-label'>Reset balance</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TotalValueCard;
