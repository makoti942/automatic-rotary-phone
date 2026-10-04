import './makoti-brand.scss';

type TMakotiBrandProps = {
    compact?: boolean;
};

const MakotiBrand = ({ compact = false }: TMakotiBrandProps) => (
    <div className={`makoti-brand${compact ? ' makoti-brand--compact' : ''}`} aria-label='Makotitraders'>
        <div className='makoti-brand__mark' aria-hidden='true'>
            <svg width='36' height='36' viewBox='0 0 36 36' fill='none'>
                <rect x='2' y='22' width='6' height='12' rx='1.5' fill='#d4a017' />
                <rect x='11' y='14' width='6' height='20' rx='1.5' fill='#e8b84a' />
                <rect x='20' y='8' width='6' height='26' rx='1.5' fill='#f0c96a' />
                <rect x='29' y='4' width='5' height='30' rx='1.5' fill='#fff' />
                <path d='M4 12 L14 8 L24 4 L33 2' stroke='#f5d98a' strokeWidth='2' strokeLinecap='round' />
                <circle cx='33' cy='2' r='2.2' fill='#fff' />
            </svg>
        </div>
        <div className='makoti-brand__text'>
            <span className='makoti-brand__name'>
                Makoti<span className='makoti-brand__name-accent'>traders</span>
            </span>
            {!compact && <span className='makoti-brand__tag'>TRADE · AUTOMATE · GROW</span>}
        </div>
    </div>
);

export default MakotiBrand;
