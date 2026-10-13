const REQUEST_TYPE_KEYS = [
    'active_symbols',
    'balance',
    'buy',
    'proposal',
    'proposal_open_contract',
    'sell',
    'ticks_history',
    'transaction',
];

export const getRequestErrorDetails = response => {
    const apiError = response?.error || {};
    const echoRequest = response?.echo_req || {};
    const nestedEchoRequest = apiError?.echo_req || {};
    const requestEcho = Object.keys(echoRequest).length ? echoRequest : nestedEchoRequest;
    const inferredType = REQUEST_TYPE_KEYS.find(key => Object.prototype.hasOwnProperty.call(requestEcho, key));

    return {
        message_type: response?.msg_type || apiError?.msg_type || inferredType || '',
        request: echoRequest?.req_id ?? nestedEchoRequest?.req_id ?? response?.req_id ?? null,
    };
};
