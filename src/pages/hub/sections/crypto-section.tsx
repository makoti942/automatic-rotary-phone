import { MOCK_CRYPTO_WALLETS } from '../mock-data';
import StubSection from './stub-section';

const CryptoSection = () => (
    <StubSection title='Crypto' accounts={MOCK_CRYPTO_WALLETS} accountLabel='DXN' />
);

export default CryptoSection;
