import { MOCK_CFD_ACCOUNTS, formatBalance } from '../mock-data';
import './stub-section.scss';

type TStubSectionProps = {
    title: string;
    accounts: { type: string; loginid: string; balance: string; currency: string; status: string }[];
    accountLabel: string;
};

const StubSection = ({ title, accounts, accountLabel }: TStubSectionProps) => {
    return (
        <div className='hub-stub'>
            <h2 className='hub-stub__title'>{title}</h2>
            <div className='hub-stub__accounts'>
                {accounts.map(account => (
                    <div key={account.loginid} className='hub-stub__account-card'>
                        <div className='hub-stub__account-header'>
                            <span className='hub-stub__account-badge'>{accountLabel}</span>
                            <span className='hub-stub__account-status'>{account.status}</span>
                        </div>
                        <p className='hub-stub__account-type'>{account.type}</p>
                        <p className='hub-stub__account-loginid'>{account.loginid}</p>
                        <div className='hub-stub__account-balance'>
                            <span className='hub-stub__account-currency'>$</span>
                            <span className='hub-stub__account-amount'>{account.balance}</span>
                            <span className='hub-stub__account-code'>{account.currency}</span>
                        </div>
                    </div>
                ))}
                <button type='button' className='hub-stub__add-card'>
                    <span className='hub-stub__add-icon'>+</span>
                    <span>Open an account</span>
                </button>
            </div>
        </div>
    );
};

export default StubSection;
