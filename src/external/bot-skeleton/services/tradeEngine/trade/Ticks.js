/* eslint-disable no-promise-executor-return */
import debounce from 'lodash.debounce';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { localize } from '@deriv-com/translations';
import { getLast } from '../../../utils/binary-utils';
import { getManualTradeDigitPercentage } from '@/utils/manual-trade-digit-stats';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import ApiHelpers from '../../api/api-helpers';
import { getDirection, getLastDigit } from '../utils/helpers';
import { isLastDigitsConditionMet } from '../utils/last-digits-condition.mjs';
import { expectPositiveInteger } from '../utils/sanitize';
import * as constants from './state/constants';

let tickListenerKey;

export default Engine =>
    class Ticks extends Engine {
        async watchTicks(symbol) {
            if (symbol && this.symbol !== symbol) {
                this.symbol = symbol;
                const { ticksService } = this.$scope;

                await ticksService.stopMonitor({
                    symbol,
                    key: tickListenerKey,
                });
                const callback = ticks => {
                    if (this.is_proposal_subscription_required) {
                        this.checkProposalReady();
                    }
                    const lastTick = ticks.slice(-1)[0];
                    if (!lastTick) return;
                    const { epoch } = lastTick;
                    this.store.dispatch({ type: constants.NEW_TICK, payload: epoch });
                };

                const key = await ticksService.monitor({ symbol, callback });
                tickListenerKey = key;
            }
        }

        checkTicksPromiseExists() {
            return this.$scope.ticksService.ticks_history_promise;
        }

        getTicks(toString = false) {
            return new Promise(resolve => {
                this.$scope.ticksService.request({ symbol: this.symbol }).then(ticks => {
                    const ticks_list = ticks.map(tick => {
                        if (toString) {
                            return tick.quote.toFixed(this.getPipSize());
                        }
                        return tick.quote;
                    });

                    resolve(ticks_list);
                });
            });
        }

        getLastTick(raw, toString = false) {
            return new Promise((resolve, reject) =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => {
                        try {
                            let last_tick = raw ? getLast(ticks) : getLast(ticks).quote;
                            if (!raw && toString) {
                                last_tick = last_tick.toFixed(this.getPipSize());
                            }
                            resolve(last_tick);
                        } catch (error) {
                            reject(error);
                        }
                    })
                    .catch(e => {
                        if (e.code === 'MarketIsClosed') {
                            const localizedError = {
                                ...e,
                                message: getLocalizedErrorMessage(e.code, e.details),
                            };
                            globalObserver.emit('Error', localizedError);
                            resolve(e.code);
                        }
                    })
            );
        }

        getLastDigit() {
            return new Promise(resolve => this.getLastTick(false, true).then(tick => resolve(getLastDigit(tick))));
        }

        getLastDigitList() {
            return new Promise(resolve => this.getTicks().then(ticks => resolve(this.getLastDigitsFromList(ticks))));
        }

        async checkLastDigits(condition, count) {
            const digits = await this.getLastDigitList();
            return isLastDigitsConditionMet(digits, condition, count);
        }

        async getDigitPercentage(digit) {
            return getManualTradeDigitPercentage(Number(digit));
        }

        async automatedParityRecoveryPurchase() {
            const currentState = this.automated_parity_recovery_state;
            // Parity is strictly a loss-recovery path. Never initialize or trade
            // parity during the bot's normal entry/Under strategy.
            if (!currentState || !(Number(currentState.totalLoss) > 0)) {
                this.notifyAutomatedRecovery(`Normal entry: DIGITUNDER on ${this.tradeOptions?.symbol || this.symbol}`, 'info');
                await this.purchase('DIGITUNDER');
                return true;
            }
            const ready = await this.prepareAutomatedParityRecovery();
            if (!ready) return false;
            const state = this.automated_parity_recovery_state;
            const contractType = state.parity === 'even' ? 'DIGITEVEN' : 'DIGITODD';
            this.tradeOptions.amount = state.nextStake;
            this.setInterpreterVariable('Current_Stake', state.nextStake);
            this.setInterpreterVariable('Current Stake', state.nextStake);
            state.phase = 'executing';
            state.lastStake = state.nextStake;
            this.notifyAutomatedRecovery(
                `Parity recovery trade: ${contractType} on ${state.selectedSymbol} | stake ${state.nextStake}`,
                'info'
            );
            await this.purchase(contractType);
            return true;
        }

        async automatedParityRecoveryStatus() {
            try {
                const symbol = this.symbol || this.tradeOptions?.symbol;
                const ticks = await this.$scope.ticksService.request({ symbol });
                const latest = ticks?.[ticks.length - 1];
                if (!latest || latest.epoch === this.automated_parity_status_epoch) return false;
                this.automated_parity_status_epoch = latest.epoch;
                const pip = this.$scope.ticksService.pipSizes[symbol] || 2;
                const digit = Number(Number(latest.quote).toFixed(pip).slice(-1));
                const recentDigits = ticks.slice(-100).map(tick => Number(Number(tick.quote).toFixed(pip).slice(-1)));
                const evenPercentage = recentDigits.length
                    ? (recentDigits.filter(value => value % 2 === 0).length / recentDigits.length) * 100
                    : 0;
                const oddPercentage = 100 - evenPercentage;
                const state = this.automated_parity_recovery_state;
                const mode = state?.totalLoss > 0
                    ? `RECOVERY ${state.phase || 'waiting'}`
                    : 'NORMAL / recovery inactive';
                this.notifyAutomatedRecovery(
                    `${mode} | ${symbol} | last digit ${digit} | even ${evenPercentage.toFixed(1)}% / odd ${oddPercentage.toFixed(1)}%`,
                    state?.totalLoss > 0 ? 'warn' : 'info'
                );
            } catch (error) {
                this.notifyAutomatedRecovery(`Status unavailable: ${error?.message || 'tick data unavailable'}`, 'warn');
            }
            return true;
        }

        async automatedParityRecoveryUpdate(profit, stake) {
            const amount = Number(stake) > 0 ? Number(stake) : Number(this.tradeOptions?.amount) || 0;
            const result = Number(profit) || 0;
            const state = this.automated_parity_recovery_state;
            if (result > 0) {
                if (state?.phase === 'executing') {
                    const remaining = Math.max(0, (Number(state.totalLoss) || 0) - result);
                    this.notifyAutomatedRecovery(
                        `Recovery win: profit ${result.toFixed(2)} | remaining loss ${remaining.toFixed(2)}`,
                        remaining <= 0.0001 ? 'success' : 'info'
                    );
                    if (remaining <= 0.0001) {
                        await this.finishAutomatedParityRecovery();
                    } else {
                        state.totalLoss = remaining;
                        state.phase = 'ready';
                        state.nextStake = this.calculateParityRecoveryStake(remaining, state.parity);
                        this.setAutomatedRecoveryVariables(true, state.nextStake);
                    }
                } else {
                    await this.finishAutomatedParityRecovery();
                }
                return;
            }
            const loss = amount > 0 ? amount : Number(state?.lastStake) || 0;
            if (!this.automated_parity_recovery_state) {
                this.automated_parity_recovery_state = {
                    normalSymbol: this.tradeOptions?.symbol,
                    totalLoss: 0,
                    lossCount: 0,
                    phase: 'idle',
                };
            }
            const next = this.automated_parity_recovery_state;
            next.totalLoss = (Number(next.totalLoss) || 0) + loss;
            next.lossCount = (Number(next.lossCount) || 0) + 1;
            next.phase = 'idle';
            next.nextStake = 0;
            this.setAutomatedRecoveryVariables(true, Math.max(0.35, loss));
            this.notifyAutomatedRecovery(
                `Recovery loss: ${loss.toFixed(2)} | total recovery balance ${next.totalLoss.toFixed(2)} | losses ${next.lossCount}`,
                'warn'
            );
        }

        async prepareAutomatedParityRecovery() {
            let state = this.automated_parity_recovery_state;
            if (!state) {
                state = this.automated_parity_recovery_state = {
                    normalSymbol: this.tradeOptions?.symbol,
                    totalLoss: 0,
                    lossCount: 0,
                    phase: 'idle',
                    selectedSymbol: null,
                    parity: null,
                    consecutiveOpposite: 0,
                    lastEpoch: null,
                };
            }
            if (state.phase === 'executing') return false;
            if (!state.selectedSymbol) {
                const symbols = this.getAvailableVolatilitySymbols();
                const samples = await Promise.all(symbols.map(symbol => this.fetchParitySample(symbol)));
                const usable = samples.filter(sample => sample && sample.count >= 100);
                if (!usable.length) return false;
                usable.sort((a, b) => b.bestPercentage - a.bestPercentage || a.distance - b.distance);
                const selected = usable[0];
                state.selectedSymbol = selected.symbol;
                state.parity = selected.parity;
                state.consecutiveOpposite = selected.trailingOpposite;
                state.lastEpoch = selected.lastEpoch;
                state.phase = selected.trailingOpposite >= 3 ? 'confirm' : 'wait_opposite';
                await this.watchTicks(selected.symbol);
                state.nextStake = this.calculateParityRecoveryStake(state.totalLoss, state.parity);
                this.setAutomatedRecoveryVariables(true, state.nextStake);
                this.notifyAutomatedRecovery(
                    `Recovery scan selected ${selected.symbol}: even ${selected.evenPercentage.toFixed(1)}% / odd ${selected.oddPercentage.toFixed(1)}% | target ${selected.parity} | stake ${state.nextStake}`,
                    'info'
                );
                return false;
            }
            const ticks = await this.$scope.ticksService.request({ symbol: state.selectedSymbol });
            const latest = ticks?.[ticks.length - 1];
            if (!latest || latest.epoch === state.lastEpoch) return false;
            state.lastEpoch = latest.epoch;
            const pip = this.$scope.ticksService.pipSizes[state.selectedSymbol] || 2;
            const digit = Number(Number(latest.quote).toFixed(pip).slice(-1));
            const recentDigits = ticks.slice(-100).map(tick => Number(Number(tick.quote).toFixed(pip).slice(-1)));
            const evenPercentage = recentDigits.length
                ? (recentDigits.filter(value => value % 2 === 0).length / recentDigits.length) * 100
                : 0;
            const oddPercentage = 100 - evenPercentage;
            const isTarget = state.parity === 'even' ? digit % 2 === 0 : digit % 2 !== 0;
            this.notifyAutomatedRecovery(
                `Recovery tick ${state.selectedSymbol}: last digit ${digit} | even ${evenPercentage.toFixed(1)}% / odd ${oddPercentage.toFixed(1)}% | target ${state.parity} | phase ${state.phase}`,
                'info'
            );
            if (state.phase === 'wait_opposite') {
                if (isTarget) state.consecutiveOpposite = 0;
                else state.consecutiveOpposite += 1;
                if (state.consecutiveOpposite >= 3) state.phase = 'confirm';
                this.notifyAutomatedRecovery(
                    `Recovery pattern: ${state.consecutiveOpposite} opposite digit(s); waiting for ${state.parity} confirmation`,
                    'info'
                );
                return false;
            }
            if (state.phase === 'confirm' && isTarget) {
                state.phase = 'ready';
                state.nextStake = this.calculateParityRecoveryStake(state.totalLoss, state.parity);
                this.setAutomatedRecoveryVariables(true, state.nextStake);
                this.notifyAutomatedRecovery(
                    `Parity confirmed: digit ${digit} is ${state.parity} | executing recovery stake ${state.nextStake}`,
                    'success'
                );
                return true;
            }
            return state.phase === 'ready';
        }

        getAvailableVolatilitySymbols() {
            const list = ApiHelpers?.instance?.active_symbols?.getSymbolsForBot?.() || [];
            return [...new Set(list
                .filter(item => item?.value && /volatility|continuous indices/i.test(`${item.group || ''} ${item.submarket || ''}`))
                .map(item => item.value))];
        }

        async fetchParitySample(symbol) {
            try {
                const response = await api_base.api.send({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks' });
                const prices = response?.history?.prices || [];
                const pip = this.$scope.ticksService.pipSizes[symbol] || 2;
                const digits = prices.slice(-100).map(price => Number(Number(price).toFixed(pip).slice(-1)));
                if (digits.length < 100) return null;
                const even = digits.filter(digit => digit % 2 === 0).length;
                const odd = digits.length - even;
                const parity = even >= odd ? 'even' : 'odd';
                const evenPercentage = (even / digits.length) * 100;
                const oddPercentage = (odd / digits.length) * 100;
                const bestPercentage = Math.max(even, odd) / digits.length * 100;
                const trailingOpposite = (() => {
                    const target = parity === 'even' ? digit => digit % 2 === 0 : digit => digit % 2 !== 0;
                    let count = 0;
                    for (let i = digits.length - 1; i >= 0 && !target(digits[i]); i -= 1) count += 1;
                    return count;
                })();
                return {
                    symbol,
                    parity,
                    evenPercentage,
                    oddPercentage,
                    bestPercentage,
                    distance: Math.abs(60 - bestPercentage),
                    trailingOpposite,
                    lastEpoch: response?.history?.times?.slice(-1)[0],
                    count: digits.length,
                };
            } catch (error) {
                return null;
            }
        }

        calculateParityRecoveryStake(totalLoss, parity) {
            if (!(Number(totalLoss) > 0)) return Number(this.tradeOptions?.amount) || 1;
            const contractType = parity === 'even' ? 'DIGITEVEN' : 'DIGITODD';
            const proposal = this.data?.proposals?.find(item => item.contract_type === contractType);
            const ask = Number(proposal?.ask_price) || Number(this.tradeOptions?.amount) || 1;
            const payout = Number(proposal?.payout) || ask * 1.95;
            const netRate = Math.max(0.01, payout / ask - 1);
            return Math.max(0.35, Math.ceil((Number(totalLoss) / netRate) * 100) / 100);
        }

        setAutomatedRecoveryVariables(isRecovery, stake) {
            this.setInterpreterVariable('is_recovery', !!isRecovery);
            this.setInterpreterVariable('is_recovery_var', !!isRecovery);
            if (Number(stake) > 0) {
                ['Current_Stake', 'Current Stake', 'CurrentStake', 'stake', 'Stake'].forEach(name =>
                    this.setInterpreterVariable(name, Number(stake))
                );
            }
        }

        notifyAutomatedRecovery(message, type = 'info') {
            globalObserver.emit('ui.log.notify', {
                className: `journal__text--${type}`,
                message,
                sound: 'silent',
            });
        }

        async finishAutomatedParityRecovery() {
            const state = this.automated_parity_recovery_state;
            const normalSymbol = state?.normalSymbol || this.options?.symbol;
            this.automated_parity_recovery_state = null;
            this.tradeOptions = { ...this.tradeOptions, symbol: normalSymbol, amount: 1 };
            this.setAutomatedRecoveryVariables(false, 1);
            this.setInterpreterVariable('prediction', 8);
            await this.watchTicks(normalSymbol);
        }

        getLastDigitsFromList(ticks) {
            const digits = ticks.map(tick => {
                return getLastDigit(tick.toFixed(this.getPipSize()));
            });
            return digits;
        }

        checkDirection(dir) {
            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => resolve(getDirection(ticks) === dir))
            );
        }

        getOhlc(args) {
            const { granularity = this.options.candleInterval || 60, field } = args || {};

            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol, granularity })
                    .then(ohlc => resolve(field ? ohlc.map(o => o[field]) : ohlc))
            );
        }

        getOhlcFromEnd(args) {
            const { index: i = 1 } = args || {};

            const index = expectPositiveInteger(Number(i), localize('Index must be a positive integer'));

            return new Promise(resolve => this.getOhlc(args).then(ohlc => resolve(ohlc.slice(-index)[0])));
        }

        getPipSize() {
            return this.$scope.ticksService.pipSizes[this.symbol];
        }

        async requestAccumulatorStats() {
            const subscription_id = this.subscription_id_for_accumulators;
            const is_proposal_requested = this.is_proposal_requested_for_accumulators;
            const proposal_request = {
                ...window.Blockly.accumulators_request,
                amount: this?.tradeOptions?.amount,
                basis: this?.tradeOptions?.basis,
                contract_type: 'ACCU',
                currency: this?.tradeOptions?.currency,
                growth_rate: this?.tradeOptions?.growth_rate,
                proposal: 1,
                subscribe: 1,
                underlying_symbol: this?.tradeOptions?.symbol,
            };
            if (!subscription_id && !is_proposal_requested) {
                this.is_proposal_requested_for_accumulators = true;
                if (proposal_request) {
                    await api_base?.api?.send(proposal_request);
                }
            }
        }

        async handleOnMessageForAccumulators() {
            let ticks_stayed_in_list = [];
            return new Promise(resolve => {
                const subscription = api_base.api.onMessage().subscribe(msg => {
                    const data = msg?.data;
                    if (!data) return;
                    if (data.msg_type === 'proposal') {
                        try {
                            this.subscription_id_for_accumulators = data.subscription.id;
                            // this was done because we can multile arrays in the respone and the list comes in reverse order
                            const stat_list = (data.proposal.contract_details.ticks_stayed_in || []).flat().reverse();
                            ticks_stayed_in_list = [...stat_list, ...ticks_stayed_in_list];
                            if (ticks_stayed_in_list.length > 0) resolve(ticks_stayed_in_list);
                        } catch (error) {
                            globalObserver.emit('Unexpected message type or no proposal found:', error);
                        }
                    }
                });
                api_base.pushSubscription(subscription);
            });
        }

        async fetchStatsForAccumulators() {
            try {
                // request stats for accumulators
                const debouncedAccumulatorsRequest = debounce(() => this.requestAccumulatorStats(), 300);
                debouncedAccumulatorsRequest();
                // wait for proposal response
                const ticks_stayed_in_list = await this.handleOnMessageForAccumulators();
                return ticks_stayed_in_list;
            } catch (error) {
                globalObserver.emit('Error in subscription promise:', error);
                throw error;
            } finally {
                // forget all proposal subscriptions so we can fetch new stats data on new call
                await api_base?.api?.send({ forget_all: 'proposal' });
                this.is_proposal_requested_for_accumulators = false;
                this.subscription_id_for_accumulators = null;
            }
        }

        async getCurrentStat() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                return ticks_stayed_in?.[0];
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getStatList() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                // we need to send only lastest 100 ticks
                return ticks_stayed_in?.slice(0, 100);
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getDelayTickValue(tick_value) {
            return new Promise((resolve, reject) => {
                try {
                    const ticks = [];
                    const symbol = this.symbol;

                    const resolveAndExit = () => {
                        this.$scope.ticksService.stopMonitor({
                            symbol,
                            key: '',
                        });
                        resolve(ticks);
                        ticks.length = 0;
                    };

                    const watchTicks = tick_list => {
                        ticks.push(tick_list);
                        const current_tick = ticks.length;
                        if (current_tick === tick_value) {
                            resolveAndExit();
                        }
                    };

                    const delayExecution = tick_list => watchTicks(tick_list);

                    if (Number(tick_value) <= 0) resolveAndExit();
                    this.$scope.ticksService.monitor({ symbol, callback: delayExecution });
                } catch (error) {
                    reject(new Error(`Failed to start tick monitoring: ${error.message}`));
                }
            });
        }
    };
