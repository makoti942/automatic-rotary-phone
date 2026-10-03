import { useState } from 'react';
import { formatBalance } from '../mock-data';
import './transfer-form.scss';

type TTransferFormProps = {
    realBalance: number;
    demoBalance: number;
    currency: string;
};

type TToast = { message: string; type: 'success' | 'error' } | null;

const SwapIcon = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <path d='M7 16V4m0 0L3 8m4-4l4 4' />
        <path d='M17 8v12m0 0l4-4m-4 4l-4-4' />
    </svg>
);

const ChevronDownIcon = () => (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <polyline points='6 9 12 15 18 9' />
    </svg>
);

const OptionsIconSmall = () => (
    <span className='transfer-form__acct-icon transfer-form__acct-icon--options'>
        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2.5'>
            <polyline points='23 6 13.5 15.5 8.5 10.5 1 18' />
            <polyline points='17 6 23 6 23 12' />
        </svg>
    </span>
);

const WalletIcon = () => (
    <span className='transfer-form__acct-icon transfer-form__acct-icon--wallet'>
        <svg width='18' height='14' viewBox='0 0 24 18' fill='none'>
            <rect x='1' y='1' width='22' height='16' rx='3' fill='#3B82F6' />
            <rect x='1' y='1' width='22' height='6' rx='2' fill='#fff' opacity='0.3' />
            <circle cx='18' cy='12' r='2' fill='#fff' />
        </svg>
    </span>
);

const TransferForm = ({ realBalance, demoBalance, currency }: TTransferFormProps) => {
    const [fromAccount, setFromAccount] = useState<'demo' | 'real'>('demo');
    const [toAccount, setToAccount] = useState<'demo' | 'real' | null>(null);
    const [amount, setAmount] = useState('');
    const [toast, setToast] = useState<TToast>(null);

    const fromBalance = fromAccount === 'demo' ? demoBalance : realBalance;
    const toBalance = toAccount === 'demo' ? demoBalance : realBalance;
    const parsedAmount = Number(amount) || 0;
    const isValid = parsedAmount > 0 && parsedAmount <= fromBalance && fromAccount !== toAccount;

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3000);
    };

    const handleTransfer = () => {
        if (!isValid) {
            showToast('Invalid transfer amount', 'error');
            return;
        }
        showToast(`Transfer of ${formatBalance(parsedAmount)} ${currency} successful`);
        setAmount('');
    };

    const handleSwap = () => {
        if (toAccount === null) return;
        setFromAccount(toAccount);
        setToAccount(fromAccount);
    };

    const handlePercentage = (pct: number) => {
        const value = (fromBalance * pct) / 100;
        setAmount(value.toFixed(2));
    };

    return (
        <div className='transfer-form'>
            <div className='transfer-form__header'>
                <h2 className='transfer-form__title'>Transfer</h2>
            </div>

            <div className='transfer-form__body'>
                <div className='transfer-form__field'>
                    <label className='transfer-form__label'>From</label>
                    <div className='transfer-form__account-box'>
                        {fromAccount === 'demo' ? <WalletIcon /> : <OptionsIconSmall />}
                        <div className='transfer-form__account-info'>
                            <span className='transfer-form__account-name'>{fromAccount === 'demo' ? 'Wallet' : 'Options'}</span>
                            <span className='transfer-form__account-bal'>{formatBalance(fromBalance)} {currency}</span>
                        </div>
                        <span className='transfer-form__chevron'><ChevronDownIcon /></span>
                    </div>
                </div>

                <button type='button' className='transfer-form__swap' onClick={handleSwap} aria-label='Swap accounts'>
                    <SwapIcon />
                </button>

                <div className='transfer-form__field'>
                    <label className='transfer-form__label'>To</label>
                    <div className='transfer-form__account-box transfer-form__account-box--select'>
                        {toAccount === 'demo' ? <WalletIcon /> : toAccount === 'real' ? <OptionsIconSmall /> : null}
                        <div className='transfer-form__account-info'>
                            <span className='transfer-form__account-name transfer-form__account-name--placeholder'>
                                {toAccount === 'demo' ? 'Wallet' : toAccount === 'real' ? 'Options' : 'Select'}
                            </span>
                            {toAccount && (
                                <span className='transfer-form__account-bal'>{formatBalance(toBalance)} {currency}</span>
                            )}
                        </div>
                        <span className='transfer-form__chevron'><ChevronDownIcon /></span>
                    </div>
                </div>

                <div className='transfer-form__field'>
                    <label className='transfer-form__label' htmlFor='transfer-amount'>Amount</label>
                    <div className='transfer-form__amount-input'>
                        <input
                            id='transfer-amount'
                            type='number'
                            className='transfer-form__input'
                            placeholder='0.00'
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            min='0'
                            step='0.01'
                        />
                        <span className='transfer-form__amount-code'>{currency}</span>
                    </div>
                </div>

                <div className='transfer-form__percentages'>
                    {[25, 50, 75, 100].map(pct => (
                        <button key={pct} type='button' className='transfer-form__pct-btn' onClick={() => handlePercentage(pct)}>
                            {pct}%
                        </button>
                    ))}
                </div>

                <button type='button' className='transfer-form__submit' disabled={!isValid} onClick={handleTransfer}>
                    Transfer
                </button>
            </div>

            {toast && (
                <div className={`transfer-form__toast transfer-form__toast--${toast.type}`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
};

export default TransferForm;
