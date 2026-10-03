import { useState } from 'react';
import { formatBalance } from '../mock-data';
import './transfer-form.scss';

type TTransferFormProps = {
    realBalance: number;
    demoBalance: number;
    currency: string;
};

type TToast = { message: string; type: 'success' | 'error' } | null;

const TransferForm = ({ realBalance, demoBalance, currency }: TTransferFormProps) => {
    const [fromAccount, setFromAccount] = useState<'demo' | 'real'>('demo');
    const [toAccount, setToAccount] = useState<'demo' | 'real'>('real');
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
        setFromAccount(toAccount);
        setToAccount(fromAccount);
    };

    return (
        <div className='transfer-form'>
            <div className='transfer-form__header'>
                <h2 className='transfer-form__title'>Transfer</h2>
                <p className='transfer-form__subtitle'>Transfer funds between your accounts</p>
            </div>

            <div className='transfer-form__body'>
                <div className='transfer-form__field'>
                    <label className='transfer-form__label'>From</label>
                    <div className='transfer-form__account-select'>
                        <select
                            className='transfer-form__select'
                            value={fromAccount}
                            onChange={e => setFromAccount(e.target.value as 'demo' | 'real')}
                        >
                            <option value='demo'>Demo account</option>
                            <option value='real'>Real account</option>
                        </select>
                        <span className='transfer-form__account-balance'>
                            ${formatBalance(fromBalance)} {currency}
                        </span>
                    </div>
                </div>

                <button type='button' className='transfer-form__swap' onClick={handleSwap} aria-label='Swap accounts'>
                    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                        <path d='M7 16V4m0 0L3 8m4-4l4 4' />
                        <path d='M17 8v12m0 0l4-4m-4 4l-4-4' />
                    </svg>
                </button>

                <div className='transfer-form__field'>
                    <label className='transfer-form__label'>To</label>
                    <div className='transfer-form__account-select'>
                        <select
                            className='transfer-form__select'
                            value={toAccount}
                            onChange={e => setToAccount(e.target.value as 'demo' | 'real')}
                        >
                            <option value='demo'>Demo account</option>
                            <option value='real'>Real account</option>
                        </select>
                        <span className='transfer-form__account-balance'>
                            ${formatBalance(toBalance)} {currency}
                        </span>
                    </div>
                </div>

                <div className='transfer-form__field'>
                    <label className='transfer-form__label' htmlFor='transfer-amount'>
                        Amount
                    </label>
                    <div className='transfer-form__amount-input'>
                        <span className='transfer-form__amount-currency'>$</span>
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
