import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { api_base } from '../../api/api-base';
import { doUntilDone, tradeOptionToProposal } from '../utils/helpers';
import { clearProposals, proposalsReady } from './state/actions';

export default Engine =>
    class Proposal extends Engine {
        makeProposals(trade_option) {
            if (!this.isNewTradeOption(trade_option)) {
                return;
            }

            // Generate a purchase reference when trade options are different from previous trade options.
            // This will ensure the bot doesn't mistakenly purchase the wrong proposal.
            this.regeneratePurchaseReference();
            this.trade_option = trade_option;
            this.proposal_templates = tradeOptionToProposal(trade_option, this.getPurchaseReference());
            this.renewProposalsOnPurchase();
        }

        selectProposal(contract_type) {
            const { proposals } = this.data;

            if (proposals.length === 0) {
                throw Error(getLocalizedErrorMessage('ProposalsNotReady'));
            }

            if (this.vh_state.enabled && this.vh_state.is_virtual) {
                const proposal = proposals.find(p => p.contract_type === contract_type);
                const stake = this.vh_state.current_stake || this.tradeOptions.amount || 1;
                return proposal
                    ? { id: proposal.id, askPrice: Number(stake) }
                    : { id: proposals[0].id, askPrice: Number(stake) };
            }

            const to_buy = proposals.find(proposal => {
                if (
                    proposal.contract_type === contract_type &&
                    proposal.purchase_reference === this.getPurchaseReference()
                ) {
                    if (proposal.error) {
                        throw proposal.error;
                    }

                    return proposal;
                }

                return false;
            });

            if (!to_buy) {
                throw new Error(getLocalizedErrorMessage('SelectedProposalNotExist'));
            }

            return {
                id: to_buy.id,
                askPrice: to_buy.ask_price,
            };
        }

        renewProposalsOnPurchase() {
            this.data.proposals = [];
            this.store.dispatch(clearProposals());
            this.requestProposals();
        }

        requestProposals() {
            const templates = [...(this.proposal_templates || [])];
            if (!templates.length) return Promise.resolve();

            // A bot can request a fresh proposal immediately after each buy. Queue
            // those requests and send them one at a time instead of bursting all
            // contract-type proposals at once and provoking more RateLimit errors.
            let has_informed_error = false;
            const requestOne = async proposal => {
                try {
                    await doUntilDone(() => api_base.api.send(proposal));
                } catch (error) {
                    const apiError = error?.error || {};
                    // We intercept ContractBuyValidationError as user may have specified
                    // e.g. a DIGITUNDER 0 or DIGITOVER 9, while one proposal may be invalid
                    // and another valid. We handle the error on Purchase rather than here.
                    if (apiError.code === 'ContractBuyValidationError') {
                        const localizedError = new Error(getLocalizedErrorMessage(apiError.code, apiError));
                        localizedError.code = apiError.code;
                        localizedError.details = apiError.details;
                        localizedError.message_to_client = apiError.message_to_client;
                        const echo_req = error?.echo_req || apiError.echo_req || {};
                        const passthrough = echo_req.passthrough || {};

                        this.data.proposals.push({
                            ...echo_req,
                            ...passthrough,
                            error: localizedError,
                        });
                        return;
                    }
                    if (!has_informed_error) {
                        has_informed_error = true;
                        const localizedErrorMessage = apiError.code
                            ? getLocalizedErrorMessage(apiError.code, apiError)
                            : apiError.message || error?.message || getLocalizedErrorMessage('GeneralError');

                        this.$scope.observer.emit('Error', {
                            ...apiError,
                            message: localizedErrorMessage,
                        });
                    }
                }
            };

            const previousQueue = this.proposalRequestQueue || Promise.resolve();
            this.proposalRequestQueue = previousQueue
                .catch(() => undefined)
                .then(async () => {
                    for (const proposal of templates) {
                        // Do not send queued proposals after the strategy has moved
                        // to a different purchase reference.
                        if (proposal?.passthrough?.purchase_reference !== this.getPurchaseReference()) continue;
                        await requestOne(proposal);
                    }
                });
            return this.proposalRequestQueue;
        }

        observeProposals() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(response => {
                if (response?.data?.msg_type === 'proposal') {
                    const { proposal, error } = response.data;
                    // The current Options API returns passthrough under echo_req.
                    // Older WebSocket responses exposed it at the top level.
                    const passthrough = response.data.passthrough || response.data.echo_req?.passthrough || {};

                    // Handle proposal errors with localized messages
                    if (error) {
                        const localizedError = new Error(getLocalizedErrorMessage(error.code, error));
                        localizedError.code = error.code;
                        localizedError.details = error.details;
                        localizedError.message_to_client = error.message_to_client;

                        this.data.proposals.push({
                            ...passthrough,
                            error: localizedError,
                        });
                        return;
                    }

                    if (proposal && this.data.proposals.findIndex(p => p.id === proposal.id) === -1) {
                        // Add proposals based on the ID returned by the API.
                        this.data.proposals.push({ ...proposal, ...passthrough });
                        this.checkProposalReady();
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        checkProposalReady() {
            // Proposals are considered ready when the proposals in our memory match the ones
            // we've requested from the API, we determine this by checking the passthrough of the response.
            const { proposals } = this.data;

            if (proposals.length > 0 && this.proposal_templates) {
                const has_equal_proposals = this.proposal_templates.every(template => {
                    return (
                        proposals.findIndex(proposal => {
                            return (
                                proposal.purchase_reference === template.passthrough.purchase_reference &&
                                proposal.contract_type === template.passthrough.contract_type
                            );
                        }) !== -1
                    );
                });

                if (has_equal_proposals) {
                    this.startPromise.then(() => this.store.dispatch(proposalsReady()));
                }
            }
        }

        isNewTradeOption(trade_option) {
            if (!this.trade_option) {
                this.trade_option = trade_option;
                return true;
            }

            // Compare incoming "trade_option" argument with "this.trade_option", if any
            // of the values is different, this is a new tradeOption and new proposals
            // should be generated.
            return [
                'amount',
                'barrierOffset',
                'basis',
                'duration',
                'duration_unit',
                'prediction',
                'secondBarrierOffset',
                'underlying_symbol',
            ].some(value => this.trade_option[value] !== trade_option[value]);
        }
    };
