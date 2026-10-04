import './makoti-trading-pill.scss';

type TMakotiTradingPillProps = {
    isActive: boolean;
};

const MakotiTradingPill = ({ isActive }: TMakotiTradingPillProps) => (
    <div className={`makoti-trading-pill${isActive ? ' makoti-trading-pill--active' : ''}`}>
        <span className='makoti-trading-pill__dot' aria-hidden='true' />
        <span className='makoti-trading-pill__label'>{isActive ? 'Trading is Active' : 'Trading Inactive'}</span>
    </div>
);

export default MakotiTradingPill;
