import HubBarspinner from './hub-barspinner';
import './hub-page-loader.scss';

type THubPageLoaderProps = {
    variant?: 'balance' | 'markets' | 'accounts';
};

/** Lightweight content-area loader — only used inside hub shell, never outside chrome. */
const HubPageLoader = ({ variant = 'balance' }: THubPageLoaderProps) => (
    <div className='hub-page-loader' aria-busy='true' aria-live='polite' data-variant={variant}>
        <HubBarspinner size='md' />
    </div>
);

export default HubPageLoader;
