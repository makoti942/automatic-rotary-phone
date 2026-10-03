import { MOCK_CFD_ACCOUNTS } from '../mock-data';
import StubSection from './stub-section';

const CfdsSection = () => (
    <StubSection title='CFDs' accounts={MOCK_CFD_ACCOUNTS} accountLabel='MT5' />
);

export default CfdsSection;
