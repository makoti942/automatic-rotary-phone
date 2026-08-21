import { localize } from '@deriv-com/translations';
import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import ApiHelpers from '../../api/api-helpers';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { openContractReceived, purchaseSuccessful, sell, start } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';
import { observer as globalObserver } from '../../../utils/observer';

let delayIndex = 0;
let purchase_reference;

const getStakeVariableName = () => {
    try {
        const workspace = window?.Blockly?.derivWorkspace || window?.Blockly?.getMainWorkspace?.();
        if (!workspace) return null;
        const blocks = workspace.getAllBlocks?.(false) || [];
        const trade_options_block = blocks.find(block =>
            [
                'trade_definition_tradeoptions',
                'trade_definition_tradeoptions_payout',
                'trade_definition_multiplier',
                'trade_definition_accumulator',
            ].includes(block.type)
        );
        if (!trade_options_block) return null;
        const amount_input = trade_options_block.getInput?.('AMOUNT');
        const target_block = amount_input?.connection?.targetBlock?.();
        if (!target_block || target_block.type !== 'variables_get') return null;
        const var_name = target_block.getFieldValue?.('VAR');
        if (!var_name) return null;
        const generated_name = window.Blockly?.JavaScript?.variableDB_?.getName?.(
            var_name,
            window.Blockly.Variables?.CATEGORY_NAME
        );
        return generated_name || var_name;
    } catch (e) {
        return null;
    }
};

const getStakeVariableCandidates = () => {
    const derived = getStakeVariableName();
    if (!derived) return [];
    const candidates = [derived];
    if (!candidates.includes('Stake')) candidates.push('Stake');
    if (!candidates.includes('stake')) candidates.push('stake');
    return candidates;
};

export default Engine =>
    class Purchase extends Engine {
        async purchase(contract_type) {
            if (this.vh_state.enabled && this.vh_state.is_virtual) {
                return this.virtualPurchase(contract_type);
            }
            return this.realPurchase(contract_type);
        }

        async virtualPurchase(contract_type) {
            this.applyAlternateMarketsToCurrentTradeOptions();

            const { duration, duration_unit, symbol } = this.tradeOptions;

            let target_ticks = 0;
            if (duration_unit === 't') {
                target_ticks = duration;
            } else {
                const duration_seconds = duration * (duration_unit === 'm' ? 60 : 1);
                target_ticks = Math.ceil(duration_seconds);
            }

            let resolved_prediction = this.tradeOptions.prediction;
            if (typeof window !== 'undefined' && window.BinaryBotCustomPrediction !== undefined) {
                resolved_prediction = Number(window.BinaryBotCustomPrediction);
                window.BinaryBotCustomPrediction = undefined;
            }

            const configured_stake = Number(this.tradeOptions.amount) || 1;
            if (!this.vh_state.initial_stake || this.vh_state.initial_stake === 0) {
                this.vh_state.initial_stake = configured_stake;
            }
            if (!this.vh_state.current_stake || this.vh_state.current_stake === 0) {
                this.vh_state.current_stake = configured_stake;
            }

            this.vh_state.virtual_trade_active = true;
            this.vh_state.virtual_tick_count = 0;
            this.vh_state.virtual_target_duration = target_ticks;
            this.vh_state.virtual_contract_type = contract_type;
            this.vh_state.virtual_prediction = resolved_prediction;
            this.vh_state.virtual_entry_spot = 0;
            this.vh_state.entry_spot_captured = false;
            this.vh_state.last_tick_epoch = null;

            this.setInterpreterVariable('BinaryBotPrivateLastTradeVirtual', true);

            this.store.dispatch(purchaseSuccessful());
            this.store.dispatch(openContractReceived());

            this.vh_state.virtual_tick_subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data?.msg_type === 'tick' && data?.tick?.symbol === symbol) {
                    this.processVirtualTick({
                        quote: data.tick.quote,
                        symbol: data.tick.symbol,
                        epoch: data.tick.epoch,
                    });
                }
            });
            api_base.pushSubscription(this.vh_state.virtual_tick_subscription);
            if (!api_base.api.sent_requests?.some(req => req.ticks === symbol)) {
                api_base.api.send({ ticks: symbol, subscribe: 1 });
            }

            return new Promise((resolve, reject) => {
                this.vh_state.virtual_resolve = resolve;
                this.vh_state.virtual_reject = reject;
                const vtTimeout = () => {
                    if (this.vh_state.virtual_trade_active) {
                        if (this.$scope?.paused_) {
                            this.vh_state.virtual_timeout = setTimeout(vtTimeout, 1000);
                            return;
                        }
                        this.resetVirtualTrade();
                        reject(new Error('Virtual trade timed out'));
                    }
                };
                this.vh_state.virtual_timeout = setTimeout(vtTimeout, 8000);
            });
        }

        processVirtualTick(tick_data) {
            if (!this.vh_state.virtual_trade_active) return;
            if (this.$scope?.paused_) return;

            const symbol = this.tradeOptions?.symbol;
            if (!symbol || tick_data.symbol !== symbol) return;

            const tick_epoch = tick_data.epoch;
            if (tick_epoch && tick_epoch === this.vh_state.last_tick_epoch) return;
            this.vh_state.last_tick_epoch = tick_epoch;

            const { virtual_target_duration, virtual_contract_type } = this.vh_state;
            const isDigitTrade = !['CALL', 'PUT'].includes(virtual_contract_type);

            if (!this.vh_state.entry_spot_captured) {
                this.vh_state.virtual_entry_spot = tick_data.quote;
                this.vh_state.entry_spot_captured = true;

                if (isDigitTrade && virtual_target_duration === 1) {
                    this.settleVirtualTrade(tick_data);
                }
                return;
            }

            this.vh_state.virtual_tick_count++;
            const current_tick_count = this.vh_state.virtual_tick_count;

            const settle_after = isDigitTrade ? virtual_target_duration - 1 : virtual_target_duration;

            if (current_tick_count >= settle_after) {
                this.settleVirtualTrade(tick_data);
            }
        }

        settleVirtualTrade(tick_data) {
            if (this.$scope?.paused_) return;
            const raw_end_spot = tick_data.quote;
            const raw_entry_spot = this.vh_state.virtual_entry_spot;

            const pip_size = this.getPipSize() || 0;
            const end_spot_str = Number(raw_end_spot).toFixed(pip_size);
            const entry_spot_str = Number(raw_entry_spot).toFixed(pip_size);

            const end_spot = Number(end_spot_str);
            const entry_spot = Number(entry_spot_str);

            const trade_contract_type = this.vh_state.virtual_contract_type;
            const prediction_barrier = parseInt(this.vh_state.virtual_prediction, 10);

            const last_digit = Number(end_spot_str.slice(-1));
            let is_win;

            switch (trade_contract_type) {
                case 'CALL':
                    is_win = end_spot > entry_spot;
                    break;
                case 'PUT':
                    is_win = end_spot < entry_spot;
                    break;
                case 'DIGITMATCH':
                    is_win = last_digit === prediction_barrier;
                    break;
                case 'DIGITDIFF':
                    is_win = last_digit !== prediction_barrier;
                    break;
                case 'DIGITOVER':
                    is_win = last_digit > prediction_barrier;
                    break;
                case 'DIGITUNDER':
                    is_win = last_digit < prediction_barrier;
                    break;
                case 'DIGITODD':
                    is_win = last_digit % 2 !== 0;
                    break;
                case 'DIGITEVEN':
                    is_win = last_digit % 2 === 0;
                    break;
                default:
                    is_win = false;
                    break;
            }

            const stake = this.vh_state.current_stake || this.tradeOptions.amount || 1;
            const simulated_contract = {
                ask_price: stake,
                payout: stake * 1.95,
                profit: is_win ? stake * 0.95 : -stake,
                status: 'sold',
                is_sold: true,
                entry_spot: entry_spot_str,
                exit_spot: end_spot_str,
                is_virtual: true,
                contract_type: trade_contract_type,
                symbol: this.tradeOptions.symbol,
            };

            this.updateVirtualTotals(simulated_contract);
            this.store.dispatch(sell());

            setTimeout(() => {
                const resolve = this.vh_state.virtual_resolve;
                this.resetVirtualTrade();
                if (resolve) resolve();

                // For virtual trades, do NOT run the bot's after_purchase blocks
                // (e.g. martingale logic) — virtual results should not affect
                // real trading stake calculations.
                try {
                    if (typeof console !== 'undefined') {
                        console.debug('[Virtual Hook] Skipping afterPromise for virtual trade');
                    }
                } catch (e) {
                    /* noop */
                }

                setTimeout(() => {
                    this.store.dispatch(start());
                }, 10);
            }, 0);
        }

        resetVirtualTrade() {
            if (this.vh_state.virtual_timeout) {
                clearTimeout(this.vh_state.virtual_timeout);
            }
            if (this.vh_state.virtual_tick_subscription) {
                this.vh_state.virtual_tick_subscription.unsubscribe();
            }
            this.vh_state.virtual_trade_active = false;
            this.vh_state.virtual_tick_count = 0;
            this.vh_state.virtual_resolve = null;
            this.vh_state.virtual_reject = null;
            this.vh_state.last_tick_epoch = null;
            this.vh_state.entry_spot_captured = false;
        }

        updateVirtualTotals(contract) {
            const win = contract.profit > 0;

            if (win) {
                this.vh_state.loss_count = 0;
                this.vh_state.current_stake = this.vh_state.initial_stake;
            } else {
                this.vh_state.loss_count++;
                if (this.vh_state.threshold > 0 && this.vh_state.loss_count >= this.vh_state.threshold) {
                    this.vh_state.is_virtual = false;
                    this.vh_state.needs_stake_reset = true;
                    this.resetStakeVariableForRealTrading();
                }
            }

            const now = Math.floor(Date.now() / 1000);
            const virtual_id = `virtual_${now}_${Math.random()}`;
            const entrySpotNum = Number(contract.entry_spot);
            const exitSpotNum = Number(contract.exit_spot);
            const virtual_contract = {
                ask_price: Number(contract.ask_price),
                buy_price: Number(contract.ask_price),
                sell_price: contract.profit > 0 ? Number(contract.payout) : 0,
                payout: contract.payout,
                profit: Number(contract.profit),
                status: 'sold',
                is_sold: true,
                is_virtual: true,
                is_completed: true,
                contract_type: contract.contract_type,
                symbol: contract.symbol,
                entry_spot: entrySpotNum,
                exit_spot: exitSpotNum,
                entry_tick: entrySpotNum,
                exit_tick: exitSpotNum,
                transaction_ids: { buy: virtual_id },
                date_start: now,
                entry_tick_time: now,
                exit_tick_time: now + (this.vh_state.virtual_target_duration || 1),
                display_name: win ? localize('Virtual Win') : localize('Virtual Loss'),
                underlying: this.tradeOptions.symbol,
                currency: this.tradeOptions.currency || 'USD',
                shortcode: `${contract.contract_type}_S0P_${this.tradeOptions.symbol.toUpperCase()}`,
                id: virtual_id,
                contract_id: virtual_id,
            };

            globalObserver.emit('bot.contract', { ...virtual_contract, is_sold: true });
        }

        setInterpreterVariable(name, value) {
            try {
                const dbot = window?.DBot;
                if (!dbot?.interpreter?.bot?.tradeEngine) return;

                const interpreter = dbot.interpreter.getInterpreter?.() || {};
                if (!interpreter || typeof interpreter.setProperty !== 'function') return;

                const val = interpreter.nativeToPseudo ? interpreter.nativeToPseudo(value) : value;

                // JSInterpreter globals live on the global pseudo-object (Interpreter.Object).
                // `interpreter.globalObject` is the canonical one; the others are fallbacks for
                // the restoreStateSnapshot path where `interpreter.global` is re-assigned.
                const scopeCandidates = [
                    interpreter.globalObject,
                    interpreter.globalScope && interpreter.globalScope.object,
                    interpreter.global,
                    interpreter.stateStack &&
                        interpreter.stateStack[0] &&
                        interpreter.stateStack[0].scope &&
                        interpreter.stateStack[0].scope.object,
                ];

                for (const candidate of scopeCandidates) {
                    if (!candidate || typeof candidate !== 'object') continue;
                    try {
                        interpreter.setProperty(candidate, name, val);
                        return;
                    } catch (e) {
                        // not the right scope, try the next candidate
                    }
                }
            } catch (e) {
                // noop
            }
        }

        resetStakeVariableForRealTrading() {
            const initialStake = this.vh_state.initial_stake || 1;
            getStakeVariableCandidates().forEach(name => this.setInterpreterVariable(name, initialStake));
        }

        onRealContractSettled(contract) {
            if (!this.vh_state?.enabled || this.vh_state?.is_virtual) return;

            const win = contract?.profit > 0;

            if (this.vh_state.needs_stake_reset) {
                this.vh_state.needs_stake_reset = false;
                this.resetStakeVariableForRealTrading();
            }

            this.vh_state.real_trade_count = (this.vh_state.real_trade_count || 0) + 1;

            if (win) {
                this.vh_state.is_virtual = true;
                this.vh_state.loss_count = 0;
                this.vh_state.step_count = 0;
                this.vh_state.current_stake = this.vh_state.initial_stake;
            }
        }

        applyAlternateMarketsToCurrentTradeOptions() {
            try {
                const force_symbol = window?.DBot?.__force_symbol;
                if (force_symbol && force_symbol !== 'disable' && this.tradeOptions?.symbol !== force_symbol) {
                    this.tradeOptions = { ...this.tradeOptions, symbol: force_symbol };
                    return this.tradeOptions;
                }

                const settings = (window && window.DBot && window.DBot.__alt_markets) || {};
                const enabled = !!settings.enabled;
                const every = Number(settings.every || 0);
                if (!enabled || !every || !this.tradeOptions?.symbol) return this.tradeOptions;

                const next_run_index = (typeof this.getTotalRuns === 'function' ? this.getTotalRuns() : 0) + 1;
                if (next_run_index % every !== 0) return this.tradeOptions;

                const helper_instance = ApiHelpers?.instance;
                const list = helper_instance?.active_symbols?.getSymbolsForBot?.() || [];
                const cont = list.filter(s => (s?.group || '').startsWith('Continuous Indices'));
                if (!cont.length) return this.tradeOptions;

                const values = cont.map(s => s.value);
                const current = this.tradeOptions.symbol;
                const idx = Math.max(0, values.indexOf(current));
                const next_symbol = values[(idx + 1) % values.length];
                if (next_symbol && next_symbol !== current) {
                    this.tradeOptions = { ...this.tradeOptions, symbol: next_symbol };
                }
            } catch (e) {
                // noop
            }
            return this.tradeOptions;
        }

        async realPurchase(contract_type) {
            this.setInterpreterVariable('BinaryBotPrivateLastTradeVirtual', false);

            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const onSuccess = response => {
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            // Virtual trades must leave no trace: when the loss threshold has
            // just flipped us back to real trading, the FIRST real purchase
            // (proposal or direct-buy) must start from the initial stake, not an
            // inflated Stake variable. Enforcing it here — before the proposal /
            // direct split — guarantees both code paths reset the amount, so the
            // stake reset cannot be bypassed by an early `return` in either branch.
            if (this.vh_state?.enabled && this.vh_state.needs_stake_reset) {
                this.tradeOptions.amount = this.vh_state.initial_stake || this.tradeOptions.amount || 1;
            }

            if (this.is_proposal_subscription_required) {
                this.applyAlternateMarketsToCurrentTradeOptions();
                try {
                    this.makeProposals({ ...this.options, ...this.tradeOptions });
                    this.checkProposalReady && this.checkProposalReady();
                } catch {}

                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }

            this.applyAlternateMarketsToCurrentTradeOptions();

        // Virtual trades must leave no trace: the interpreter Stake variable was
        // reset to initial_stake by resetStakeVariableForRealTrading() at the
        // threshold, and after_purchase blocks are skipped during virtual trades,
        // so the first real trade starts from a clean base (initial stake). The
        // early enforcement above already set tradeOptions.amount; this second
        // guard only covers the direct-buy path and keeps it consistent.
        if (this.vh_state?.enabled && this.vh_state.needs_stake_reset) {
            this.tradeOptions.amount = this.vh_state.initial_stake || this.tradeOptions.amount || 1;
        }

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
