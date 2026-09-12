import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => {
        const contract = tradeEngine.data.contract;
        if (!contract || Object.keys(contract).length === 0) {
            return '';
        }
        return createDetails(contract)[i];
    };

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: contract_type => tradeEngine.purchase(contract_type),
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        setVirtualHook: settings => {
            if (tradeEngine.vh_state) {
                if (typeof settings.enabled !== 'undefined') {
                    tradeEngine.vh_state.enabled = !!settings.enabled;
                    if (settings.enabled) {
                        tradeEngine.vh_state.is_virtual = true;
                        tradeEngine.vh_state.loss_count = 0;
                        tradeEngine.vh_state.step_count = 0;
                        tradeEngine.vh_state.initial_stake = 0;
                        tradeEngine.vh_state.current_stake = 0;
                    }
                }
                if (typeof settings.threshold !== 'undefined')
                    tradeEngine.vh_state.threshold = Number(settings.threshold);
                if (typeof settings.martingaleFactor !== 'undefined')
                    tradeEngine.vh_state.martingaleFactor = Number(settings.martingaleFactor);
                if (typeof settings.maxSteps !== 'undefined')
                    tradeEngine.vh_state.maxSteps = Number(settings.maxSteps);
                if (typeof settings.minTradesOnReal !== 'undefined')
                    tradeEngine.vh_state.minTradesOnReal = Number(settings.minTradesOnReal);
                if (typeof settings.takeProfit !== 'undefined')
                    tradeEngine.vh_state.takeProfit = Number(settings.takeProfit);
                if (typeof settings.stopLoss !== 'undefined')
                    tradeEngine.vh_state.stopLoss = Number(settings.stopLoss);
            }
        },
        setBulkTrade: settings => {
            if (tradeEngine.vh_state) {
                if (typeof settings.enabled !== 'undefined') {
                    tradeEngine.vh_state.bulk_enabled = !!settings.enabled;
                }
                if (typeof settings.count !== 'undefined') {
                    tradeEngine.vh_state.bulk_count = Math.max(1, Number(settings.count) || 1);
                }
            }
        },
    };
};

const getProposal = (contract_type, tradeEngine) => {
    return tradeEngine.data.proposals.find(
        proposal =>
            proposal.contract_type === contract_type &&
            proposal.purchase_reference === tradeEngine.getPurchaseReference()
    );
};

const getSellPrice = tradeEngine => {
    return tradeEngine.getSellPrice();
};

export default getBotInterface;
