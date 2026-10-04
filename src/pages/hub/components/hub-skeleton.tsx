import './hub-skeleton.scss';

type THubSkeletonProps = {
    width?: string | number;
    height?: string | number;
    radius?: string;
    className?: string;
};

export const HubSkeletonBlock = ({
    width = '100%',
    height = '16px',
    radius = '8px',
    className = '',
}: THubSkeletonProps) => (
    <span
        className={`hub-skeleton ${className}`.trim()}
        style={{ width, height, borderRadius: radius }}
        aria-hidden='true'
    />
);

type THubSkeletonCardProps = {
    className?: string;
    variant?: 'market' | 'account' | 'promo' | 'list';
};

export const HubSkeletonCard = ({ className = '', variant = 'market' }: THubSkeletonCardProps) => (
    <div className={`hub-skeleton-card hub-skeleton-card--${variant} ${className}`.trim()} aria-hidden='true'>
        {variant === 'market' && (
            <>
                <div className='hub-skeleton-card__row'>
                    <HubSkeletonBlock width='36px' height='36px' radius='50%' />
                    <div className='hub-skeleton-card__col'>
                        <HubSkeletonBlock width='72px' height='12px' />
                        <HubSkeletonBlock width='48px' height='10px' />
                    </div>
                </div>
                <HubSkeletonBlock width='64px' height='14px' />
            </>
        )}
        {variant === 'account' && (
            <>
                <div className='hub-skeleton-card__row'>
                    <HubSkeletonBlock width='40px' height='40px' radius='12px' />
                    <div className='hub-skeleton-card__col'>
                        <HubSkeletonBlock width='96px' height='12px' />
                        <HubSkeletonBlock width='72px' height='10px' />
                    </div>
                </div>
                <HubSkeletonBlock width='80px' height='16px' />
            </>
        )}
        {variant === 'promo' && (
            <div className='hub-skeleton-card__promo'>
                <div className='hub-skeleton-card__col'>
                    <HubSkeletonBlock width='40%' height='12px' />
                    <HubSkeletonBlock width='70%' height='18px' />
                    <HubSkeletonBlock width='50%' height='12px' />
                </div>
            </div>
        )}
        {variant === 'list' && (
            <>
                <div className='hub-skeleton-card__row'>
                    <div className='hub-skeleton-card__col'>
                        <HubSkeletonBlock width='120px' height='12px' />
                        <HubSkeletonBlock width='80px' height='10px' />
                    </div>
                    <HubSkeletonBlock width='64px' height='14px' />
                </div>
            </>
        )}
    </div>
);

type THubSkeletonGridProps = {
    count?: number;
    variant?: 'market' | 'account' | 'promo' | 'list';
    className?: string;
};

export const HubSkeletonGrid = ({ count = 4, variant = 'market', className = '' }: THubSkeletonGridProps) => (
    <div className={`hub-skeleton-grid hub-skeleton-grid--${variant} ${className}`.trim()} aria-hidden='true'>
        {Array.from({ length: count }).map((_, i) => (
            <HubSkeletonCard key={i} variant={variant} />
        ))}
    </div>
);

export default HubSkeletonGrid;
