import { formatBalance } from '../mock-data';
import './trading-account-card.scss';

type TTradingAccountCardProps = {
    title: string;
    loginid?: string;
    balance: number;
    currency: string;
    iconType?: 'mt5' | 'options' | 'dxn';
    isActive?: boolean;
    onClick?: () => void;
};

const ProductIcon = ({ type }: { type: string }) => {
    if (type === 'mt5') {
        return (
            <span className='trading-account-card__icon trading-account-card__icon--mt5'>
                <span className='trading-account-card__icon-main'>MT5</span>
                <span className='trading-account-card__icon-sub'>STD</span>
            </span>
        );
    }
    if (type === 'options') {
        return (
            <span className='trading-account-card__icon trading-account-card__icon--options'>
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2.5'>
                    <polyline points='23 6 13.5 15.5 8.5 10.5 1 18' />
                    <polyline points='17 6 23 6 23 12' />
                </svg>
            </span>
        );
    }
    return (
        <span className='trading-account-card__icon trading-account-card__icon--dxn'>
            <span className='trading-account-card__icon-main'>DXN</span>
        </span>
    );
};

const TradingAccountCard = ({
    title,
    loginid,
    balance,
    currency,
    iconType = 'options',
    isActive = false,
    onClick,
}: TTradingAccountCardProps) => {
    return (
        <button
            type='button'
            className={`trading-account-card${isActive ? ' trading-account-card--active' : ''}`}
            onClick={onClick}
        >
            <ProductIcon type={iconType} />
            <p className='trading-account-card__title'>{title}</p>
            <div className='trading-account-card__balance'>
                <span className='trading-account-card__amount'>{formatBalance(balance)}</span>
                <span className='trading-account-card__code'>{currency}</span>
            </div>
        </button>
    );
};

export default TradingAccountCard;
