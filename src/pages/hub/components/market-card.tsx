import { generateSparkline } from '../mock-data';
import './market-card.scss';

type TMarketCardProps = {
    name: string;
    price: string;
    change: string;
    changeColor: string;
    spark: number[];
    icon?: React.ReactNode;
    badge?: string;
    onClick?: () => void;
};

const MarketCard = ({ name, price, change, changeColor, spark, icon, badge, onClick }: TMarketCardProps) => {
    const sparkPath = generateSparkline(spark);

    return (
        <button type='button' className='market-card' onClick={onClick}>
            <div className='market-card__icon-row'>
                {icon && <span className='market-card__icon'>{icon}</span>}
                {badge && <span className='market-card__badge'>{badge}</span>}
            </div>
            <p className='market-card__name'>{name}</p>
            <p className='market-card__price'>{price}</p>
            <div className='market-card__chart-row'>
                <svg className='market-card__spark' width='100' height='28' viewBox='0 0 100 28'>
                    <path d={sparkPath} fill='none' stroke={changeColor} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
                </svg>
                <span className='market-card__change' style={{ color: changeColor }}>
                    {change} (5m)
                </span>
            </div>
        </button>
    );
};

export default MarketCard;
