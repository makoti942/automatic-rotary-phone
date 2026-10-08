import React, { FormEvent, useEffect, useState } from 'react';
import {
    addCopyToken,
    initializeCopyAccounts,
    removeCopyToken,
    subscribeCopyAccounts,
    type CopyAccount,
} from './copy-trade-executor';
import './copy-trading.scss';

const CopyTrading: React.FC = () => {
    const [accounts, setAccounts] = useState<CopyAccount[]>([]);
    const [token, setToken] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        let active = true;
        initializeCopyAccounts().catch(() => {});
        const unsubscribe = subscribeCopyAccounts(next => {
            if (active) setAccounts(next);
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    const handleAddToken = async (event: FormEvent) => {
        event.preventDefault();
        if (!token.trim() || isAdding) return;
        setIsAdding(true);
        setStatusMsg('Authorizing token and reading account details…');
        try {
            await addCopyToken(token);
            setToken('');
            setStatusMsg('Account connected. New trades will be executed there automatically.');
        } catch (error: any) {
            setStatusMsg(error?.message || 'Could not authorize this token.');
        } finally {
            setIsAdding(false);
        }
    };

    const connectedCount = accounts.filter(account => account.status === 'connected').length;

    return (
        <div className='ct'>
            <div className='ct__token-hero'>
                <div>
                    <span className='ct__eyebrow'>DIRECT EXECUTION</span>
                    <h3>Trade across your Deriv accounts</h3>
                    <p className='ct__setup-desc'>
                        Add API tokens once. Every new trade from this app is sent directly to each connected account—no master account, Firebase relay, or follower delay.
                    </p>
                </div>
                <div className='ct__connection-pill'>
                    <span className={`ct__status-dot ${connectedCount ? 'ct__status-dot--active' : ''}`} />
                    {connectedCount} connected
                </div>
            </div>

            <form className='ct__token-form' onSubmit={handleAddToken}>
                <label htmlFor='copy-api-token'>Deriv API token</label>
                <div className='ct__token-input-row'>
                    <input
                        id='copy-api-token'
                        className='ct__input'
                        type='password'
                        autoComplete='off'
                        placeholder='Paste a token with trading permission'
                        value={token}
                        onChange={event => setToken(event.target.value)}
                        disabled={isAdding}
                    />
                    <button className='ct__btn ct__btn--primary ct__token-submit' type='submit' disabled={!token.trim() || isAdding}>
                        {isAdding ? 'Checking…' : 'Add account'}
                    </button>
                </div>
                <small>Tokens are stored locally in this browser and are not uploaded to Firebase.</small>
            </form>

            {statusMsg && <div className='ct__status' onClick={() => setStatusMsg('')}>{statusMsg}</div>}

            <div className='ct__section'>
                <div className='ct__section-header'>
                    <span>Connected accounts <b className='ct__count'>{accounts.length}</b></span>
                    <a className='ct__token-link' href='https://home.deriv.com/dashboard/profile/api-tokens' target='_blank' rel='noreferrer'>Create token ↗</a>
                </div>
                {accounts.length === 0 ? (
                    <div className='ct__empty'>Add a Deriv API token to connect an account. You can add as many accounts as you need.</div>
                ) : (
                    <div className='ct__account-list'>
                        {accounts.map(account => (
                            <article className={`ct__account-card ct__account-card--${account.status}`} key={account.id}>
                                <div className='ct__account-card-head'>
                                    <div className='ct__account-avatar'>{account.name === 'Authorizing account…' ? '…' : account.name.slice(0, 1).toUpperCase()}</div>
                                    <div className='ct__account-identity'>
                                        <strong>{account.name}</strong>
                                        <span>{account.loginid} · {account.tokenHint}</span>
                                    </div>
                                    <button className='ct__account-remove' type='button' onClick={() => removeCopyToken(account.id)} aria-label={`Remove ${account.name}`}>×</button>
                                </div>
                                <div className='ct__account-details'>
                                    <div><small>ACCOUNT</small><b className={account.isDemo ? 'ct__demo' : 'ct__real'}>{account.isDemo ? 'DEMO' : 'REAL'}</b></div>
                                    <div><small>BALANCE</small><b>{account.balance == null ? '—' : `${account.currency} ${account.balance.toFixed(2)}`}</b></div>
                                    <div><small>STATUS</small><b className={`ct__account-status ct__account-status--${account.status}`}>{account.status === 'connected' ? 'READY' : account.status.toUpperCase()}</b></div>
                                </div>
                                {account.error && <div className='ct__account-error'>{account.error}</div>}
                            </article>
                        ))}
                    </div>
                )}
            </div>

            <div className='ct__execution-note'>
                <span className='ct__execution-note-icon'>↗</span>
                <div>
                    <strong>Copy execution is active</strong>
                    <span>Connected accounts receive the same contract parameters and stake when you execute a trade. Demo and real accounts can be used together.</span>
                </div>
            </div>
        </div>
    );
};

export default CopyTrading;
