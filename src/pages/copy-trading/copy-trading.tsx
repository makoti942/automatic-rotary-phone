import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    getMaster,
    setMaster,
    addFollower,
    removeFollower,
    getFollowers,
    getAllMasters,
    getFollowerStats,
    type MasterProfile,
    type FollowerEntry,
    type FollowerStats,
} from './firebase-config';
import {
    installCopyTradeInterceptor,
    uninstallCopyTradeInterceptor,
    resetFollowerStats,
    subscribeBalance,
    subscribeOpenContracts,
    onTradeMessage,
    saveMyBalance,
    hasContractBeenCounted,
    markContractCounted,
} from './copy-trade-executor';
import './copy-trading.scss';

function getAccountId(): string {
    try { return localStorage.getItem('active_loginid') || ''; }
    catch { return ''; }
}

function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

interface TradeRecord {
    id: string;
    type: string;
    stake: number;
    pnl: number;
    time: number;
    status: 'won' | 'lost' | 'pending';
}

const STORAGE_KEY_TRADES = 'mw_copy_trade_history';
const STORAGE_KEY_STATS = 'mw_copy_stats';

function loadPersistedTrades(): TradeRecord[] {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_TRADES) || '[]'); }
    catch { return []; }
}

function loadPersistedStats() {
    try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY_STATS) || 'null');
        return s || { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 };
    } catch { return { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 }; }
}

const CopyTrading: React.FC = () => {
    const [mode, setMode] = useState<'none' | 'master' | 'follower'>(() => {
        return (localStorage.getItem('mw_copy_mode') as 'master' | 'follower') || 'none';
    });
    const [masterIdInput, setMasterIdInput] = useState('');
    const [masterName, setMasterName] = useState('');
    const [myMasterId, setMyMasterId] = useState('');
    const [followerToken, setFollowerToken] = useState('');
    const [followerName, setFollowerName] = useState('');
    const [followers, setFollowers] = useState<Record<string, FollowerEntry>>({});
    const [stats, setStats] = useState(loadPersistedStats);
    const [statusMsg, setStatusMsg] = useState('');
    const [balance, setBalance] = useState<number | null>(null);
    const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>(loadPersistedTrades);
    const [availableMasters, setAvailableMasters] = useState<Record<string, MasterProfile>>({});
    const [selectedMaster, setSelectedMaster] = useState<{ id: string; profile: MasterProfile } | null>(null);
    const [followerStatsMap, setFollowerStatsMap] = useState<Record<string, FollowerStats>>({});
    const [followerBalances, setFollowerBalances] = useState<Record<string, number>>({});
    const accountId = useRef(getAccountId());

    // Persist tradeHistory to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(tradeHistory));
    }, [tradeHistory]);

    // Persist stats to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
    }, [stats]);

    const loadMasterProfile = useCallback(async () => {
        const id = localStorage.getItem('mw_copy_master_id');
        if (!id) return;
        const profile = await getMaster(id);
        if (profile) {
            setMyMasterId(id);
            setMasterName(profile.name);
            setMode('master');
            localStorage.setItem('mw_copy_mode', 'master');
            const f = await getFollowers(id);
            if (f) setFollowers(f);
        }
    }, []);

    const loadFollowerStatus = useCallback(async () => {
        const id = localStorage.getItem('mw_copy_follower_master');
        if (!id) {
            const masters = await getAllMasters();
            setAvailableMasters(masters);
            return;
        }
        setMasterIdInput(id);
        setMode('follower');
        localStorage.setItem('mw_copy_mode', 'follower');
    }, []);

    useEffect(() => {
        loadMasterProfile();
        loadFollowerStatus();
    }, [loadMasterProfile, loadFollowerStatus]);

    useEffect(() => {
        const id = localStorage.getItem('mw_copy_master_id');
        if (id && mode === 'master') {
            installCopyTradeInterceptor(id);
        }
        return () => uninstallCopyTradeInterceptor();
    }, [mode]);

    // ── Listen for balance + trade results ──
    useEffect(() => {
        const unsub = onTradeMessage((data: any) => {
            try {
                if (data.msg_type === 'balance' && data.balance) {
                    const newBal = Number(data.balance.balance);
                    setBalance(newBal);

                    // Master pushes own balance
                    const mid = localStorage.getItem('mw_copy_master_id');
                    const fid = localStorage.getItem('mw_copy_follower_master');
                    if (mid) {
                        saveMyBalance(mid, accountId.current, newBal);
                    }
                }

                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                    const poc = data.proposal_open_contract;
                    if (poc.is_sold && poc.contract_id) {
                        // Prevent double-counting
                        if (hasContractBeenCounted(poc.contract_id)) return;
                        markContractCounted(poc.contract_id);

                        const profit = Number(poc.profit) || 0;
                        const stake = Number(poc.buy_price) || 0;
                        const won = profit > 0;
                        const record: TradeRecord = {
                            id: poc.contract_id,
                            type: poc.contract_type || 'UNKNOWN',
                            stake,
                            pnl: profit,
                            time: Date.now(),
                            status: won ? 'won' : 'lost',
                        };
                        setTradeHistory(prev => [record, ...prev].slice(0, 100));
                        setStats(prev => ({
                            totalTrades: prev.totalTrades + 1,
                            wins: prev.wins + (won ? 1 : 0),
                            losses: prev.losses + (won ? 0 : 1),
                            totalPnl: prev.totalPnl + profit,
                        }));
                    }
                }
            } catch {}
        });

        subscribeBalance().catch(() => {});
        subscribeOpenContracts().catch(() => {});
        return () => unsub();
    }, []);

    // ── Load per-follower stats + balances for master ──
    const loadFollowerData = useCallback(async () => {
        if (mode !== 'master' || !myMasterId) return;
        const f = await getFollowers(myMasterId);
        if (!f) return;
        setFollowers(f);
        const statsMap: Record<string, FollowerStats> = {};
        const balMap: Record<string, number> = {};
        for (const fid of Object.keys(f)) {
            const s = await getFollowerStats(myMasterId, fid);
            if (s) statsMap[fid] = s;
            try {
                const res = await fetch(`https://makoti-6ba23-default-rtdb.firebaseio.com/masters/${myMasterId}/followers/${fid}/balance.json`);
                if (res.ok) {
                    const b = await res.json();
                    if (b !== null) balMap[fid] = Number(b);
                }
            } catch {}
        }
        setFollowerStatsMap(statsMap);
        setFollowerBalances(balMap);
    }, [mode, myMasterId]);

    useEffect(() => {
        if (mode !== 'master' || !myMasterId) return;
        loadFollowerData();
        const interval = setInterval(loadFollowerData, 8000);
        return () => clearInterval(interval);
    }, [mode, myMasterId, loadFollowerData]);

    const handleBecomeMaster = async () => {
        if (!masterName.trim()) { setStatusMsg('Enter your display name'); return; }
        const id = accountId.current || Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        const profile: MasterProfile = { name: masterName.trim(), account_id: id, created_at: Date.now() };
        const ok = await setMaster(id, profile);
        if (ok) {
            setMyMasterId(id);
            setMode('master');
            localStorage.setItem('mw_copy_mode', 'master');
            localStorage.setItem('mw_copy_master_id', id);
            setStatusMsg('Master profile created!');
        } else {
            setStatusMsg('Failed — check Firebase config');
        }
    };

    const handleFollow = async () => {
        if (!masterIdInput.trim()) { setStatusMsg('Enter a master ID'); return; }
        if (!followerToken.trim()) { setStatusMsg('Enter your Deriv API token'); return; }
        const master = await getMaster(masterIdInput.trim());
        if (!master) { setStatusMsg('Master not found'); return; }
        const followerId = accountId.current || Math.random().toString(36).substring(2, 10);
        const entry: FollowerEntry = {
            token: followerToken.trim(),
            name: followerName.trim() || 'Follower',
            account_id: followerId,
            created_at: Date.now(),
        };
        const ok = await addFollower(masterIdInput.trim(), followerId, entry);
        if (ok) {
            setMode('follower');
            localStorage.setItem('mw_copy_mode', 'follower');
            localStorage.setItem('mw_copy_follower_master', masterIdInput.trim());
            setStatusMsg(`Following ${master.name}!`);
        } else {
            setStatusMsg('Failed — check Firebase config');
        }
    };

    const handleUnfollow = async () => {
        await removeFollower(masterIdInput, accountId.current);
        setMode('none');
        localStorage.removeItem('mw_copy_mode');
        localStorage.removeItem('mw_copy_follower_master');
        setStatusMsg('Unfollowed');
    };

    const handleRemoveFollower = async (fid: string) => {
        await removeFollower(myMasterId, fid);
        const updated = { ...followers };
        delete updated[fid];
        setFollowers(updated);
        setStatusMsg('Follower removed');
    };

    const handleClearStats = () => {
        setTradeHistory([]);
        setStats({ totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 });
        localStorage.removeItem(STORAGE_KEY_TRADES);
        localStorage.removeItem(STORAGE_KEY_STATS);
        setStatusMsg('Stats cleared');
    };

    const followerCount = Object.keys(followers).length;
    const winRate = stats.totalTrades > 0 ? ((stats.wins / stats.totalTrades) * 100).toFixed(1) : '0.0';

    return (
        <div className='ct'>
            <div className='ct__balance'>
                <span className='ct__balance-label'>Balance</span>
                <span className='ct__balance-value'>
                    {balance !== null ? `$${balance.toFixed(2)}` : '---'}
                </span>
            </div>

            {statusMsg && (
                <div className='ct__status' onClick={() => setStatusMsg('')}>{statusMsg}</div>
            )}

            {mode === 'none' && (
                <div className='ct__setup'>
                    <h3>Copy Trading</h3>
                    <p className='ct__setup-desc'>
                        Become a Master to broadcast your trades, or Follow a Master to auto-copy.
                    </p>
                    <div className='ct__role-choice'>
                        <div className='ct__role-card' onClick={() => setMode('master')}>
                            <span className='ct__role-icon'>👑</span>
                            <span className='ct__role-title'>Become Master</span>
                            <span className='ct__role-desc'>Your trades copy to followers</span>
                        </div>
                        <div className='ct__role-card' onClick={() => setMode('follower')}>
                            <span className='ct__role-icon'>📋</span>
                            <span className='ct__role-title'>Follow Master</span>
                            <span className='ct__role-desc'>Auto-copy a master's trades</span>
                        </div>
                    </div>
                </div>
            )}

            {mode === 'master' && !myMasterId && (
                <div className='ct__setup'>
                    <h3>Set Up Master Profile</h3>
                    <input className='ct__input' placeholder='Your display name' value={masterName} onChange={e => setMasterName(e.target.value)} />
                    <button className='ct__btn ct__btn--primary' onClick={handleBecomeMaster}>Create Master Profile</button>
                    <button className='ct__btn ct__btn--ghost' onClick={() => { setMode('none'); localStorage.removeItem('mw_copy_mode'); }}>Back</button>
                </div>
            )}

            {mode === 'follower' && !localStorage.getItem('mw_copy_follower_master') && !selectedMaster && (
                <div className='ct__setup'>
                    <h3>Choose a Master</h3>
                    <button className='ct__btn ct__btn--small' style={{ marginBottom: 10 }} onClick={loadFollowerStatus}>
                        Refresh List
                    </button>
                    {Object.keys(availableMasters).length === 0 ? (
                        <div className='ct__empty'>No masters available yet.</div>
                    ) : (
                        <div className='ct__master-list'>
                            {Object.entries(availableMasters).map(([mid, m]) => {
                                if (mid === accountId.current) return null;
                                return (
                                    <div key={mid} className='ct__master-card' onClick={() => {
                                        setSelectedMaster({ id: mid, profile: m });
                                        setMasterIdInput(mid);
                                    }}>
                                        <div className='ct__master-card-avatar'>{getInitials(m.name)}</div>
                                        <div className='ct__master-card-info'>
                                            <span className='ct__master-card-name'>{m.name}</span>
                                            <span className='ct__master-card-id'>{mid}</span>
                                        </div>
                                        <span className='ct__master-card-follow'>Follow →</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <button className='ct__btn ct__btn--ghost' style={{ marginTop: 10 }} onClick={() => { setMode('none'); localStorage.removeItem('mw_copy_mode'); }}>Back</button>
                </div>
            )}

            {mode === 'follower' && !localStorage.getItem('mw_copy_follower_master') && selectedMaster && (
                <div className='ct__setup'>
                    <div className='ct__selected-master'>
                        <div className='ct__master-card-avatar'>{getInitials(selectedMaster.profile.name)}</div>
                        <span>{selectedMaster.profile.name}</span>
                        <button className='ct__btn ct__btn--small' onClick={() => setSelectedMaster(null)}>Change</button>
                    </div>
                    <h3>Enter Your API Token</h3>
                    <input className='ct__input' placeholder='Your Deriv API token (trade scope)' value={followerToken} onChange={e => setFollowerToken(e.target.value)} type='password' />
                    <input className='ct__input' placeholder='Your display name (optional)' value={followerName} onChange={e => setFollowerName(e.target.value)} />
                    <p className='ct__setup-desc' style={{ margin: '4px 0', fontSize: 10 }}>
                        Works with demo or real tokens. Master trades demo → your real account gets the same trade.
                    </p>
                    <button className='ct__btn ct__btn--primary' onClick={handleFollow}>Follow {selectedMaster.profile.name}</button>
                    <button className='ct__btn ct__btn--ghost' onClick={() => { setSelectedMaster(null); setMode('none'); localStorage.removeItem('mw_copy_mode'); }}>Back</button>
                </div>
            )}

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
                            <span className='ct__stat-value ct__stat-value--green'>{winRate}%</span>
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
                            <button className='ct__btn ct__btn--small' onClick={loadFollowerData}>Refresh</button>
                        </div>
                        {followerCount === 0 ? (
                            <div className='ct__empty'>Share your Master ID: <strong>{myMasterId}</strong></div>
                        ) : (
                            <div className='ct__follower-list'>
                                {Object.entries(followers).map(([fid, f]) => {
                                    const fs = followerStatsMap[fid];
                                    const fBal = followerBalances[fid];
                                    return (
                                        <div key={fid} className='ct__follower'>
                                            <div className='ct__follower-avatar'>{getInitials(f.name)}</div>
                                            <div className='ct__follower-info'>
                                                <span className='ct__follower-name'>{f.name}</span>
                                                <span className='ct__follower-id'>{f.account_id}</span>
                                                {fBal !== undefined && (
                                                    <span className='ct__follower-balance'>Balance: ${fBal.toFixed(2)}</span>
                                                )}
                                                {fs && (
                                                    <span className='ct__follower-stats'>
                                                        {fs.totalTrades} trades · {fs.wins}W/{fs.losses}L ·
                                                        <span className={fs.totalPnl >= 0 ? 'ct__stat-value--green' : 'ct__stat-value--red'}>
                                                            {' '}${fs.totalPnl.toFixed(2)}
                                                        </span>
                                                    </span>
                                                )}
                                            </div>
                                            <button className='ct__btn ct__btn--danger' onClick={() => handleRemoveFollower(fid)}>Remove</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className='ct__section'>
                        <div className='ct__section-header'>
                            <span>Recent Trades</span>
                            <button className='ct__btn ct__btn--small' onClick={handleClearStats}>Clear Stats</button>
                        </div>
                        {tradeHistory.length === 0 ? (
                            <div className='ct__empty'>No trades yet. Start trading in Manual Trade or Bot Builder.</div>
                        ) : (
                            <div className='ct__trade-list'>
                                {tradeHistory.slice(0, 20).map(t => (
                                    <div key={t.id} className={`ct__trade ct__trade--${t.status}`}>
                                        <span className='ct__trade-type'>{t.type}</span>
                                        <span className='ct__trade-stake'>${t.stake.toFixed(2)}</span>
                                        <span className={`ct__trade-pnl ct__trade-pnl--${t.status}`}>
                                            {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <button className='ct__btn ct__btn--ghost' onClick={() => {
                        setMode('none');
                        setMyMasterId('');
                        localStorage.removeItem('mw_copy_mode');
                        localStorage.removeItem('mw_copy_master_id');
                    }}>Stop Being Master</button>
                </div>
            )}

            {mode === 'follower' && localStorage.getItem('mw_copy_follower_master') && (
                <div className='ct__dashboard'>
                    <div className='ct__header'>
                        <div className='ct__avatar ct__avatar--follower'>📋</div>
                        <div className='ct__header-info'>
                            <h3>Following Master</h3>
                            <span className='ct__id'>Master ID: {masterIdInput}</span>
                        </div>
                    </div>
                    <div className='ct__follower-status'>
                        <div className='ct__status-dot ct__status-dot--active' />
                        <span>Connected — all trades auto-execute on your account</span>
                    </div>

                    <div className='ct__section'>
                        <div className='ct__section-header'><span>Your Trade History</span></div>
                        {tradeHistory.length === 0 ? (
                            <div className='ct__empty'>No trades yet. Waiting for master to trade...</div>
                        ) : (
                            <div className='ct__trade-list'>
                                {tradeHistory.slice(0, 20).map(t => (
                                    <div key={t.id} className={`ct__trade ct__trade--${t.status}`}>
                                        <span className='ct__trade-type'>{t.type}</span>
                                        <span className='ct__trade-stake'>${t.stake.toFixed(2)}</span>
                                        <span className={`ct__trade-pnl ct__trade-pnl--${t.status}`}>
                                            {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <button className='ct__btn ct__btn--danger' onClick={handleUnfollow}>Unfollow & Disconnect</button>
                </div>
            )}
        </div>
    );
};

export default CopyTrading;
