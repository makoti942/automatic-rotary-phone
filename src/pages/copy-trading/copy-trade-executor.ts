import { getFollowers } from './firebase-config';
import { sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';

/**
 * Global copy trade interceptor.
 * Listens for ALL buy messages on the WebSocket and forwards them to followers.
 * Master's trade is already executed by the bot/manual system — this only
 * handles the follower side.
 */

let interceptorInstalled = false;
let masterId: string | null = null;

/**
 * Install the global interceptor. Call once on app load if user is a master.
 */
export function installCopyTradeInterceptor(mId: string) {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    masterId = mId;

    window.addEventListener('newSystemMessage', async (event: Event) => {
        try {
            const customEvent = event as CustomEvent;
            const data = JSON.parse(customEvent.detail?.data || customEvent.detail || '{}');

            // Detect a successful buy on master's account
            if (data.msg_type === 'buy' && data.buy && data.buy.contract_id) {
                const buy = data.buy;
                const contractId = buy.contract_id;

                // Reconstruct trade parameters from the buy response
                // The buy response contains: contract_type, buy_price, payout, etc.
                // We need to get the full proposal details to replicate
                forwardTradeToFollowers(contractId, buy);
            }
        } catch {}
    });
}

export function uninstallCopyTradeInterceptor() {
    interceptorInstalled = false;
    masterId = null;
}

/**
 * When master's buy succeeds, get the proposal details and forward to followers.
 */
async function forwardTradeToFollowers(contractId: string, buyData: any) {
    if (!masterId) return;

    const followers = await getFollowers(masterId);
    if (!followers || Object.keys(followers).length === 0) return;

    const tokens = Object.values(followers).map(f => f.token).filter(Boolean);
    if (tokens.length === 0) return;

    // Try buy_contract_for_multiple_accounts with the same proposal
    // The proposal ID from master's buy can be reused with '1' + parameters
    try {
        // Get contract details to know what was bought
        const pocResult = await sendViaNewSystemWithPromise({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 0,
        });

        const contract = (pocResult as any)?.proposal_open_contract;
        if (!contract) return;

        // Reconstruct the buy parameters for followers
        const params: Record<string, unknown> = {
            amount: Number(buyData.buy_price) || contract.buy_price || 1,
            basis: 'stake',
            contract_type: contract.contract_type || 'DIGITUNDER',
            currency: contract.currency || 'USD',
            duration: contract.duration || 1,
            duration_unit: contract.duration_unit || 't',
            underlying_symbol: contract.underlying || '1HZ100V',
        };

        // Add barrier if present
        if (contract.barrier) {
            params.barrier = contract.barrier;
        }

        // Execute on all follower accounts
        for (let i = 0; i < tokens.length; i += 100) {
            const batch = tokens.slice(i, i + 100);
            try {
                await sendViaNewSystemWithPromise({
                    buy: '1',
                    price: Number(buyData.buy_price) || 1,
                    parameters: params,
                    tokens: batch,
                });
            } catch (err) {
                console.error('[CopyTrade] Follower batch buy failed:', err);
            }
        }
    } catch (err) {
        console.error('[CopyTrade] Failed to forward trade:', err);
    }
}

/**
 * Manual copy trade execution (for test button in Copy Trading tab).
 * Master trade is NOT executed here — only follower side.
 */
export async function executeManualCopyTrade(
    mId: string,
    tradeParams: Record<string, unknown>,
    stake: number
): Promise<{ followers: { id: string; ok: boolean; error?: string }[] }> {
    const followers = await getFollowers(mId);
    if (!followers || Object.keys(followers).length === 0) {
        return { followers: [] };
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const [fid, f] of Object.entries(followers)) {
        if (!f.token) {
            results.push({ id: fid, ok: false, error: 'No token' });
            continue;
        }
        try {
            await sendViaNewSystemWithPromise({
                buy: '1',
                price: stake,
                parameters: tradeParams,
            });
            results.push({ id: fid, ok: true });
        } catch (err: any) {
            results.push({ id: fid, ok: false, error: err?.error?.message || 'Failed' });
        }
    }

    return { followers: results };
}
