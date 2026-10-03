import useHubBalance from '../use-hub-balance';
import TransferForm from '../components/transfer-form';
import './transfer-section.scss';

const TransferSection = () => {
    const hub = useHubBalance();

    return (
        <div className='hub-transfer'>
            <TransferForm
                realBalance={hub.realDemoBalance}
                demoBalance={hub.isSandboxActive ? hub.sandboxBalance : hub.trickBalance}
                currency={hub.activeCurrency}
            />
        </div>
    );
};

export default TransferSection;
