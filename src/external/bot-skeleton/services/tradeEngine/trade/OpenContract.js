import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(msg => {
                const data = msg?.data;
                if (!data) return;
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    if (this.isSold) {
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.stopSettlementPolling();
                        this.updateTotals(contract);
                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        this.onRealContractSettled?.(contract);

                        this.store.dispatch(sell());
                    } else {
                        this.startSettlementPolling();
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        // Actively poll the open contract so a missed or delayed
        // proposal_open_contract push can never stall the bot between trades
        // (waitForAfter would otherwise hang until the sold push arrives).
        startSettlementPolling() {
            this.stopSettlementPolling();
            this.settlement_poll_interval = setInterval(() => {
                if (!this.contractId || this.isSold) {
                    this.stopSettlementPolling();
                    return;
                }
                try {
                    api_base.api.send({ proposal_open_contract: 1, contract_id: this.contractId });
                } catch (e) {
                    /* noop */
                }
            }, 5000);
        }

        stopSettlementPolling() {
            if (this.settlement_poll_interval) {
                clearInterval(this.settlement_poll_interval);
                this.settlement_poll_interval = null;
            }
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
