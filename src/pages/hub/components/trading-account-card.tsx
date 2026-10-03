import { formatBalance } from '../mock-data';
import './trading-account-card.scss';

type TTradingAccountCardProps = {
    title: string;
    loginid: string;
    balance: number;
    currency: string;
    isReal?: boolean;
    isActive?: boolean;
    onClick?: () => void;
};

const TradingAccountCard = ({
    title,
    loginid,
    balance,
    currency,
    isReal = false,
    isActive = false,
    onClick,
}: TTradingAccountCardProps) => {
    return (
        <button
            type='button'
            className={`trading-account-card${isActive ? ' trading-account-card--active' : ''}${isReal ? ' trading-account-card--real' : ''}`}
            onClick={onClick}
        >
            <div className='trading-account-card__header'>
                <span className={`trading-account-card__badge${isReal ? ' trading-account-card__badge--real' : ''}`}>
                    {isReal ? 'Real' : 'Demo'}
                </span>
                {isActive && <span className='trading-account-card__active-dot' />}
            </div>
            <p className='trading-account-card__title'>{title}</p>
            <p className='trading-account-card__loginid'>{loginid}</p>
            <div className='trading-account-card__balance'>
                <span className='trading-account-card__currency'>$</span>
                <span className='trading-account-card__amount'>{formatBalance(balance)}</span>
                <span className='trading-account-card__code'>{currency}</span>
            </div>
        </button>
    );
};

export default TradingAccountCard;
