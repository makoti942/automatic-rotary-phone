import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    getMaster,
    setMaster,
    addFollower,
    removeFollower,
    getFollowers,
    type MasterProfile,
    type FollowerEntry,
} from './firebase-config';
import { executeCopyTrade } from './copy-trade-executor';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import './copy-trading.scss';

function getAccountId(): string {
    try {
        return localStorage.getItem('active_loginid') || '';
    } catch { return ''; }
}

function generateId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

const CopyTrading: React.FC = () => {
    const [mode, setMode] = useState<'none' | 'master' | 'follower'>(() => {
        return (localStorage.getItem('mw_copy_mode') as 'master' | 'follower') || 'none';
    });
    const [masterId, setMasterId] = useState('');
    const [masterName, setMasterName] = useState('');
    const [myMasterId, setMyMasterId] = useState('');
    const [followerToken, setFollowerToken] = useState('');
    const [followerName, setFollowerName] = useState('');
    const [followers, setFollowers] = useState<Record<string, FollowerEntry>>({});
    const [stats, setStats] = useState({ totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 });
    const [statusMsg, setStatusMsg] = useState('');
    const [balance, setBalance] = useState<number | null>(null);
    const accountId = useRef(getAccountId());
    const tradeHistoryRef = useRef<{ id: string; type: string; pnl: number; time: number }[]>([]);

    // Load master profile from Firebase
    const loadMasterProfile = useCallback(async () => {
        const id = localStorage.getItem('mw_copy_master_id');
        if (!id) return;
        const profile = await getMaster(id);
        if (profile) {
            setMyMasterId(id);
            setMasterName(profile.name);
            setMode('master');
            localStorage.setItem('mw_copy_mode', 'master');
            // Load followers
            const f = await getFollowers(id);
            if (f) setFollowers(f);
        }
    }, []);

    // Load follower status
    const loadFollowerStatus = useCallback(async () => {
        const id = localStorage.getItem('mw_copy_follower_master');
        if (!id) return;
        setMasterId(id);
        setMode('follower');
        localStorage.setItem('mw_copy_mode', 'follower');
    }, []);

    useEffect(() => {
        loadMasterProfile();
        loadFollowerStatus();
    }, [loadMasterProfile, loadFollowerStatus]);

    // Listen for balance updates
    useEffect(() => {
        const unsub = onNewSystemMessage((event: any) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type === 'balance' && data.balance) {
                    setBalance(Number(data.balance.balance));
                }
            } catch {}
        });
        // Request balance
        sendViaNewSystemWithPromise({ balance: 1, subscribe: 1 }).catch(() => {});
        return () => unsub();
    }, []);

    // ── Master: Become a master ──────────────────────────────
    const handleBecomeMaster = async () => {
        if (!masterName.trim()) {
            setStatusMsg('Enter your display name');
            return;
        }
        const id = accountId.current || generateId();
        const profile: MasterProfile = {
            name: masterName.trim(),
            account_id: id,
            created_at: Date.now(),
        };
        const ok = await setMaster(id, profile);
        if (ok) {
            setMyMasterId(id);
            setMode('master');
            localStorage.setItem('mw_copy_mode', 'master');
            localStorage.setItem('mw_copy_master_id', id);
            setStatusMsg('Master profile created!');
        } else {
            setStatusMsg('Failed to create master profile. Check Firebase config.');
        }
    };

    // ── Follower: Follow a master ────────────────────────────
    const handleFollow = async () => {
        if (!masterId.trim()) {
            setStatusMsg('Enter a master ID');
            return;
        }
        if (!followerToken.trim()) {
            setStatusMsg('Enter your Deriv API token');
            return;
        }
        // Verify the master exists
        const master = await getMaster(masterId.trim());
        if (!master) {
            setStatusMsg('Master not found. Check the ID.');
            return;
        }
        const followerId = accountId.current || generateId();
        const entry: FollowerEntry = {
            token: followerToken.trim(),
            name: followerName.trim() || 'Follower',
            account_id: followerId,
            created_at: Date.now(),
        };
        const ok = await addFollower(masterId.trim(), followerId, entry);
        if (ok) {
            setMode('follower');
            localStorage.setItem('mw_copy_mode', 'follower');
            localStorage.setItem('mw_copy_follower_master', masterId.trim());
            setStatusMsg(`Now following ${master.name}!`);
        } else {
            setStatusMsg('Failed to connect. Check Firebase config.');
        }
    };

    // ── Follower: Unfollow ───────────────────────────────────
    const handleUnfollow = async () => {
        const followerId = accountId.current;
        await removeFollower(masterId, followerId);
        setMode('none');
        localStorage.removeItem('mw_copy_mode');
        localStorage.removeItem('mw_copy_follower_master');
        setStatusMsg('Unfollowed master');
    };

    // ── Master: Remove a follower ────────────────────────────
    const handleRemoveFollower = async (fid: string) => {
        await removeFollower(myMasterId, fid);
        const updated = { ...followers };
        delete updated[fid];
        setFollowers(updated);
        setStatusMsg('Follower removed');
    };

    // ── Master: Copy trade to followers (called from strategies) ──
    const handleCopyTrade = useCallback(async (tradeParams: Record<string, unknown>, stake: number) => {
        if (mode !== 'master' || !myMasterId) return;
        try {
            const result = await executeCopyTrade(myMasterId, tradeParams, stake);
            const won = (result.master as any)?.buy?.profit > 0;
            tradeHistoryRef.current = [
                {
                    id: Date.now().toString(),
                    type: (tradeParams.contract_type as string) || 'UNKNOWN',
                    pnl: won ? stake * 0.9 : -stake,
                    time: Date.now(),
                },
                ...tradeHistoryRef.current.slice(0, 49),
            ];
            setStats(prev => ({
                totalTrades: prev.totalTrades + 1,
                wins: prev.wins + (won ? 1 : 0),
                losses: prev.losses + (won ? 0 : 1),
                totalPnl: prev.totalPnl + (won ? stake * 0.9 : -stake),
            }));
        } catch (err: any) {
            console.error('Copy trade error:', err);
        }
    }, [mode, myMasterId]);

    // Expose handleCopyTrade globally for strategies to call
    useEffect(() => {
        if (mode === 'master') {
            (window as any).__copyTradeExecutor = handleCopyTrade;
        }
        return () => { delete (window as any).__copyTradeExecutor; };
    }, [mode, handleCopyTrade]);

    // ── Master: Copy trade button (manual test) ──────────────
    const [testStake, setTestStake] = useState(1);
    const handleTestCopy = async () => {
        const params = {
            amount: testStake,
            basis: 'stake',
            contract_type: 'DIGITUNDER',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            underlying_symbol: '1HZ100V',
            barrier: '7',
        };
        await handleCopyTrade(params, testStake);
        setStatusMsg('Test copy trade executed!');
    };

    // ── Master: Refresh followers ────────────────────────────
    const handleRefreshFollowers = async () => {
        const f = await getFollowers(myMasterId);
        if (f) setFollowers(f);
        setStatusMsg('Followers refreshed');
    };

    const followerCount = Object.keys(followers).length;

    return (
        <div className='ct'>
            {/* ── Balance ── */}
            <div className='ct__balance'>
                <span className='ct__balance-label'>Balance</span>
                <span className='ct__balance-value'>
                    {balance !== null ? `$${balance.toFixed(2)}` : '---'}
                </span>
            </div>

            {/* ── Status message ── */}
            {statusMsg && (
                <div className='ct__status' onClick={() => setStatusMsg('')}>
                    {statusMsg}
                </div>
            )}

            {/* ── Mode: None → choose role ── */}
            {mode === 'none' && (
                <div className='ct__setup'>
                    <h3>Copy Trading</h3>
                    <p className='ct__setup-desc'>
                        Become a Master to broadcast your trades, or Follow a Master to auto-copy their trades.
                    </p>

                    <div className='ct__role-choice'>
                        <div className='ct__role-card' onClick={() => setMode('master' as any)}>
                            <span className='ct__role-icon'>👑</span>
                            <span className='ct__role-title'>Become Master</span>
                            <span className='ct__role-desc'>Your trades copy to followers</span>
                        </div>
                        <div className='ct__role-card' onClick={() => setMode('follower' as any)}>
                            <span className='ct__role-icon'>📋</span>
                            <span className='ct__role-title'>Follow Master</span>
                            <span className='ct__role-desc'>Auto-copy a master's trades</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Mode: Master setup ── */}
            {mode === 'master' && !myMasterId && (
                <div className='ct__setup'>
                    <h3>Set Up Master Profile</h3>
                    <input
                        className='ct__input'
                        placeholder='Your display name'
                        value={masterName}
                        onChange={e => setMasterName(e.target.value)}
                    />
                    <button className='ct__btn ct__btn--primary' onClick={handleBecomeMaster}>
                        Create Master Profile
                    </button>
                    <button className='ct__btn ct__btn--ghost' onClick={() => { setMode('none'); localStorage.removeItem('mw_copy_mode'); }}>
                        Back
                    </button>
                </div>
            )}

            {/* ── Mode: Follower setup ── */}
            {mode === 'follower' && !localStorage.getItem('mw_copy_follower_master') && (
                <div className='ct__setup'>
                    <h3>Follow a Master</h3>
                    <input
                        className='ct__input'
                        placeholder="Master's ID"
                        value={masterId}
                        onChange={e => setMasterId(e.target.value)}
                    />
                    <input
                        className='ct__input'
                        placeholder='Your Deriv API token (trade scope)'
                        value={followerToken}
                        onChange={e => setFollowerToken(e.target.value)}
                        type='password'
                    />
                    <input
                        className='ct__input'
                        placeholder='Your display name (optional)'
                        value={followerName}
                        onChange={e => setFollowerName(e.target.value)}
                    />
                    <button className='ct__btn ct__btn--primary' onClick={handleFollow}>
                        Follow
                    </button>
                    <button className='ct__btn ct__btn--ghost' onClick={() => { setMode('none'); localStorage.removeItem('mw_copy_mode'); }}>
                        Back
                    </button>
                </div>
            )}

            {/* ── Mode: Master dashboard ── */}
            {mode === 'master' && myMasterId && (
                <div className='ct__dashboard'>
                    <div className='ct__header'>
                        <div className='ct__avatar'>{getInitials(masterName || 'M')}</div>
                        <div className='ct__header-info'>
                            <h3>{masterName}</h3>
                            <span className='ct__id'>ID: {myMasterId}</span>
                        </div>
                    </div>

                    <div className='ct__stats'>
                        <div className='ct__stat'>
                            <span className='ct__stat-value'>{stats.totalTrades}</span>
                            <span className='ct__stat-label'>Trades</span>
                        </div>
                        <div className='ct__stat'>
                            <span className='ct__stat-value ct__stat-value--green'>
                                {stats.totalTrades > 0 ? ((stats.wins / stats.totalTrades) * 100).toFixed(0) : 0}%
                            </span>
                            <span className='ct__stat-label'>Win Rate</span>
                        </div>
                        <div className='ct__stat'>
                            <span className={`ct__stat-value ${stats.totalPnl >= 0 ? 'ct__stat-value--green' : 'ct__stat-value--red'}`}>
                                ${stats.totalPnl.toFixed(2)}
                            </span>
                            <span className='ct__stat-label'>P/L</span>
                        </div>
                        <div className='ct__stat'>
                            <span className='ct__stat-value'>{followerCount}</span>
                            <span className='ct__stat-label'>Followers</span>
                        </div>
                    </div>

                    <div className='ct__section'>
                        <div className='ct__section-header'>
                            <span>Followers ({followerCount})</span>
                            <button className='ct__btn ct__btn--small' onClick={handleRefreshFollowers}>Refresh</button>
                        </div>
                        {followerCount === 0 ? (
                            <div className='ct__empty'>No followers yet. Share your Master ID: <strong>{myMasterId}</strong></div>
                        ) : (
                            <div className='ct__follower-list'>
                                {Object.entries(followers).map(([fid, f]) => (
                                    <div key={fid} className='ct__follower'>
                                        <div className='ct__follower-avatar'>{getInitials(f.name)}</div>
                                        <div className='ct__follower-info'>
                                            <span className='ct__follower-name'>{f.name}</span>
                                            <span className='ct__follower-id'>{f.account_id}</span>
                                        </div>
                                        <button className='ct__btn ct__btn--danger' onClick={() => handleRemoveFollower(fid)}>
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className='ct__section'>
                        <div className='ct__section-header'>
                            <span>Test Copy Trade</span>
                        </div>
                        <div className='ct__test-trade'>
                            <input
                                className='ct__input ct__input--small'
                                type='number'
                                min={0.35}
                                step={0.1}
                                value={testStake}
                                onChange={e => setTestStake(Number(e.target.value))}
                                placeholder='Stake'
                            />
                            <button
                                className='ct__btn ct__btn--primary'
                                onClick={handleTestCopy}
                                disabled={followerCount === 0}
                            >
                                Execute on All
                            </button>
                        </div>
                    </div>

                    <button className='ct__btn ct__btn--ghost' onClick={() => {
                        setMode('none');
                        setMyMasterId('');
                        localStorage.removeItem('mw_copy_mode');
                        localStorage.removeItem('mw_copy_master_id');
                    }}>
                        Stop Being Master
                    </button>
                </div>
            )}

            {/* ── Mode: Follower dashboard ── */}
            {mode === 'follower' && localStorage.getItem('mw_copy_follower_master') && (
                <div className='ct__dashboard'>
                    <div className='ct__header'>
                        <div className='ct__avatar ct__avatar--follower'>📋</div>
                        <div className='ct__header-info'>
                            <h3>Following Master</h3>
                            <span className='ct__id'>Master ID: {masterId}</span>
                        </div>
                    </div>

                    <div className='ct__follower-status'>
                        <div className='ct__status-dot ct__status-dot--active' />
                        <span>Connected — trades will auto-execute on your account</span>
                    </div>

                    <button className='ct__btn ct__btn--danger' onClick={handleUnfollow}>
                        Unfollow & Disconnect
                    </button>
                </div>
            )}
        </div>
    );
};

export default CopyTrading;
