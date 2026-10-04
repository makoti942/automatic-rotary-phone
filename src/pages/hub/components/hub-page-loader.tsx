import HubBarspinner from './hub-barspinner';
import { HubSkeletonBlock, HubSkeletonGrid } from './hub-skeleton';
import './hub-page-loader.scss';

type THubPageLoaderProps = {
    variant?: 'balance' | 'markets' | 'accounts';
};

const HubPageLoader = ({ variant = 'balance' }: THubPageLoaderProps) => {
    if (variant === 'markets') {
        return (
            <div className='hub-page-skeleton' aria-busy='true' aria-live='polite'>
                <div className='hub-page-skeleton__hero'>
                    <div className='hub-page-skeleton__hero-col'>
                        <HubSkeletonBlock width='100px' height='12px' radius='6px' />
                        <HubSkeletonBlock width='160px' height='28px' radius='8px' />
                    </div>
                </div>
                <div className='hub-page-skeleton__section'>
                    <HubSkeletonBlock className='hub-page-skeleton__title' />
                    <HubSkeletonGrid count={4} variant='market' />
                </div>
            </div>
        );
    }

    return (
        <div className='hub-page-skeleton' aria-busy='true' aria-live='polite'>
            <div className='hub-page-skeleton__hero'>
                <div className='hub-page-skeleton__hero-col'>
                    <HubSkeletonBlock width='90px' height='12px' radius='6px' />
                    <div className='hub-page-skeleton__hero-row'>
                        <div className='hub-page-skeleton__hero-col'>
                            <HubSkeletonBlock width='140px' height='12px' radius='6px' />
                            <HubSkeletonBlock width='180px' height='32px' radius='8px' />
                            <HubSkeletonBlock width='120px' height='12px' radius='6px' />
                        </div>
                        <HubBarspinner size='sm' />
                    </div>
                </div>
            </div>
            <div className='hub-page-skeleton__section'>
                <HubSkeletonBlock className='hub-page-skeleton__title' />
                <HubSkeletonGrid count={4} variant='account' />
            </div>
        </div>
    );
};

export default HubPageLoader;
