import { formatBalance } from '../mock-data';
import './trading-account-card.scss';

type TTradingAccountCardProps = {
    title: string;
    loginid: string;
    balance: number;
    currency: string;
    isActive?: boolean;
    onClick?: () => void;
};

const TradingAccountCard = ({
    title,
    loginid,
    balance,
    currency,
    isActive = false,
    onClick,
}: TTradingAccountCardProps) => {
    return (
        <button
            type='button'
            className={`trading-account-card${isActive ? ' trading-account-card--active' : ''}`}
            onClick={onClick}
        >
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
