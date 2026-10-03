import { formatBalance } from '../mock-data';
import './total-value-card.scss';

type TTotalValueCardProps = {
    totalValue: number;
    currency: string;
    selectedView: 'real' | 'demo';
    onSelectView: (view: 'real' | 'demo') => void;
    variant?: 'home' | 'options';
};

const TotalValueCard = ({
    totalValue,
    currency,
    selectedView,
    onSelectView,
    variant = 'home',
}: TTotalValueCardProps) => {
    return (
        <div className={`total-value-card total-value-card--${variant}`}>
            <div className='total-value-card__header'>
                <h2 className='total-value-card__title'>Total value</h2>
                <div className='total-value-card__toggle'>
                    <button
                        type='button'
                        className={`total-value-card__toggle-btn${selectedView === 'real' ? ' total-value-card__toggle-btn--active' : ''}`}
                        onClick={() => onSelectView('real')}
                    >
                        Real
                    </button>
                    <button
                        type='button'
                        className={`total-value-card__toggle-btn${selectedView === 'demo' ? ' total-value-card__toggle-btn--active' : ''}`}
                        onClick={() => onSelectView('demo')}
                    >
                        Demo
                    </button>
                </div>
            </div>
            <div className='total-value-card__value'>
                <span className='total-value-card__currency'>$</span>
                <span className='total-value-card__amount'>{formatBalance(totalValue)}</span>
                <span className='total-value-card__currency-code'>{currency}</span>
            </div>
        </div>
    );
};

export default TotalValueCard;
