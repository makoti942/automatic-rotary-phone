import { generateSparkline } from '../mock-data';
import './market-card.scss';

type TMarketCardProps = {
    name: string;
    price: string;
    change: string;
    changeColor: string;
    spark: number[];
    icon?: React.ReactNode;
    onClick?: () => void;
};

const MarketCard = ({ name, price, change, changeColor, spark, icon, onClick }: TMarketCardProps) => {
    const sparkPath = generateSparkline(spark);

    return (
        <button type='button' className='market-card' onClick={onClick}>
            <div className='market-card__left'>
                {icon && <span className='market-card__icon'>{icon}</span>}
                <div className='market-card__info'>
                    <p className='market-card__name'>{name}</p>
                    <p className='market-card__price'>{price}</p>
                </div>
            </div>
            <div className='market-card__chart'>
                <svg width='80' height='30' viewBox='0 0 80 30'>
                    <path d={sparkPath} fill='none' stroke={changeColor} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
                </svg>
                <span className='market-card__change' style={{ color: changeColor }}>
                    {change}
                </span>
            </div>
        </button>
    );
};

export default MarketCard;
