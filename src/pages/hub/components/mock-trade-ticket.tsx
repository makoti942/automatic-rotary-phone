import { useState } from 'react';
import './mock-trade-ticket.scss';

type TMockTradeTicketProps = {
    marketName: string;
};

type TToast = { message: string; type: 'success' | 'error' } | null;

const DURATIONS = ['5 ticks', '10 ticks', '15 ticks', '30 ticks', '1 min', '2 min', '5 min'];

const MockTradeTicket = ({ marketName }: TMockTradeTicketProps) => {
    const [contractType, setContractType] = useState<'Rise' | 'Fall'>('Rise');
    const [duration, setDuration] = useState(DURATIONS[0]);
    const [stake, setStake] = useState('10.00');
    const [toast, setToast] = useState<TToast>(null);
    const [lastResult, setLastResult] = useState<{ status: 'Won' | 'Lost'; profit: string } | null>(null);

    const parsedStake = Number(stake) || 0;
    const payout = parsedStake * 1.95;
    const isValid = parsedStake > 0;

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3000);
    };

    const handlePurchase = () => {
        if (!isValid) {
            showToast('Invalid stake amount', 'error');
            return;
        }
        const isWin = Math.random() > 0.45;
        if (isWin) {
            const profit = (parsedStake * 0.95).toFixed(2);
            setLastResult({ status: 'Won', profit: `+${profit}` });
            showToast(`Contract purchased — Won +$${profit}`);
        } else {
            setLastResult({ status: 'Lost', profit: `-${parsedStake.toFixed(2)}` });
            showToast(`Contract purchased — Lost -$${parsedStake.toFixed(2)}`, 'error');
        }
    };

    return (
        <div className='mock-trade-ticket'>
            <div className='mock-trade-ticket__header'>
                <h3 className='mock-trade-ticket__title'>Trade — {marketName}</h3>
            </div>

            <div className='mock-trade-ticket__body'>
                <div className='mock-trade-ticket__field'>
                    <label className='mock-trade-ticket__label'>Contract</label>
                    <div className='mock-trade-ticket__contract-toggle'>
                        <button
                            type='button'
                            className={`mock-trade-ticket__contract-btn${contractType === 'Rise' ? ' mock-trade-ticket__contract-btn--rise mock-trade-ticket__contract-btn--active' : ''}`}
                            onClick={() => setContractType('Rise')}
                        >
                            Rise
                        </button>
                        <button
                            type='button'
                            className={`mock-trade-ticket__contract-btn${contractType === 'Fall' ? ' mock-trade-ticket__contract-btn--fall mock-trade-ticket__contract-btn--active' : ''}`}
                            onClick={() => setContractType('Fall')}
                        >
                            Fall
                        </button>
                    </div>
                </div>

                <div className='mock-trade-ticket__field'>
                    <label className='mock-trade-ticket__label' htmlFor='trade-duration'>
                        Duration
                    </label>
                    <select
                        id='trade-duration'
                        className='mock-trade-ticket__select'
                        value={duration}
                        onChange={e => setDuration(e.target.value)}
                    >
                        {DURATIONS.map(d => (
                            <option key={d} value={d}>
                                {d}
                            </option>
                        ))}
                    </select>
                </div>

                <div className='mock-trade-ticket__field'>
                    <label className='mock-trade-ticket__label' htmlFor='trade-stake'>
                        Stake (USD)
                    </label>
                    <input
                        id='trade-stake'
                        type='number'
                        className='mock-trade-ticket__input'
                        value={stake}
                        onChange={e => setStake(e.target.value)}
                        min='0.35'
                        step='0.01'
                    />
                </div>

                <div className='mock-trade-ticket__payout'>
                    <span className='mock-trade-ticket__payout-label'>Payout</span>
                    <span className='mock-trade-ticket__payout-value'>~${payout.toFixed(2)}</span>
                </div>

                <button type='button' className='mock-trade-ticket__purchase' disabled={!isValid} onClick={handlePurchase}>
                    Purchase
                </button>

                {lastResult && (
                    <div className={`mock-trade-ticket__last-result mock-trade-ticket__last-result--${lastResult.status.toLowerCase()}`}>
                        <span>Last trade:</span>
                        <span className='mock-trade-ticket__last-status'>{lastResult.status}</span>
                        <span className='mock-trade-ticket__last-profit'>{lastResult.profit} USD</span>
                    </div>
                )}
            </div>

            {toast && (
                <div className={`mock-trade-ticket__toast mock-trade-ticket__toast--${toast.type}`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
};

export default MockTradeTicket;
