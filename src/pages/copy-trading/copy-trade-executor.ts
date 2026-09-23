import { getFollowers, type FollowerEntry } from './firebase-config';
import { sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';

/**
 * Executes a trade on the master's account AND all connected follower accounts
 * using Deriv's `buy_contract_for_multiple_accounts` WS endpoint.
 *
 * @param masterId   – the master's unique ID (account_id)
 * @param tradeParams – the contract parameters (same as buy with parameters)
 * @param stake       – the stake amount
 */
export async function executeCopyTrade(
    masterId: string,
    tradeParams: Record<string, unknown>,
    stake: number
): Promise<{ master: unknown; followers: { id: string; ok: boolean; error?: string }[] }> {
    // 1. Execute on master's own account first
    let masterResult: unknown = null;
    try {
        masterResult = await sendViaNewSystemWithPromise({
            buy: '1',
            price: stake,
            parameters: tradeParams,
        });
    } catch (err: any) {
        throw new Error(`Master trade failed: ${err?.error?.message || err?.message || 'Unknown error'}`);
    }

    // 2. Get all follower tokens from Firebase
    const followers = await getFollowers(masterId);
    if (!followers || Object.keys(followers).length === 0) {
        return { master: masterResult, followers: [] };
    }

    // 3. Execute on each follower account via buy_contract_for_multiple_accounts
    const results: { id: string; ok: boolean; error?: string }[] = [];

    const tokenEntries = Object.entries(followers);
    for (let i = 0; i < tokenEntries.length; i += 100) {
        // Deriv allows max 100 accounts per request
        const batch = tokenEntries.slice(i, i + 100);
        const tokens = batch.map(([, f]) => f.token).filter(Boolean);

        if (tokens.length === 0) continue;

        try {
            await sendViaNewSystemWithPromise({
                buy_contract_for_multiple_accounts: tradeParams,
                price: stake,
                tokens,
            });
            batch.forEach(([id]) => results.push({ id, ok: true }));
        } catch (err: any) {
            const errorMsg = err?.error?.message || err?.message || 'Trade failed';
            batch.forEach(([id]) => results.push({ id, ok: false, error: errorMsg }));
        }
    }

    return { master: masterResult, followers: results };
}

/**
 * Simpler fallback: execute trade individually for each follower
 * (useful if buy_contract_for_multiple_accounts is not available)
 */
export async function executeCopyTradeIndividually(
    masterId: string,
    tradeParams: Record<string, unknown>,
    stake: number
): Promise<{ master: unknown; followers: { id: string; ok: boolean; error?: string }[] }> {
    // Execute on master
    let masterResult: unknown = null;
    try {
        masterResult = await sendViaNewSystemWithPromise({
            buy: '1',
            price: stake,
            parameters: tradeParams,
        });
    } catch (err: any) {
        throw new Error(`Master trade failed: ${err?.error?.message || err?.message || 'Unknown error'}`);
    }

    // Get followers
    const followers = await getFollowers(masterId);
    if (!followers || Object.keys(followers).length === 0) {
        return { master: masterResult, followers: [] };
    }

    // Note: Individual execution requires opening separate WS connections per follower token
    // This is a placeholder for future implementation if bulk purchase is not available
    const results: { id: string; ok: boolean; error?: string }[] = [];
    Object.entries(followers).forEach(([id]) => {
        results.push({ id, ok: false, error: 'Individual execution not yet implemented — use bulk purchase' });
    });

    return { master: masterResult, followers: results };
}
