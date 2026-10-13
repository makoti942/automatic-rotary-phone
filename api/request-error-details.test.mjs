import assert from 'node:assert/strict';
import test from 'node:test';
import { getRequestErrorDetails } from '../src/external/bot-skeleton/services/tradeEngine/utils/request-error-details.mjs';

test('uses the response message type and request ID when present', () => {
    assert.deepEqual(
        getRequestErrorDetails({
            msg_type: 'proposal',
            echo_req: { proposal: 1, req_id: 651 },
            error: { code: 'RateLimit' },
        }),
        { message_type: 'proposal', request: 651 }
    );
});

test('infers message type from echo_req when the response omits msg_type', () => {
    assert.deepEqual(
        getRequestErrorDetails({
            echo_req: { buy: '1', req_id: 22 },
            error: { code: 'RateLimit' },
        }),
        { message_type: 'buy', request: 22 }
    );
});

test('reads nested API error metadata and safely handles missing fields', () => {
    assert.deepEqual(
        getRequestErrorDetails({ error: { code: 'RateLimit', msg_type: 'proposal_open_contract', echo_req: { req_id: 7 } } }),
        { message_type: 'proposal_open_contract', request: 7 }
    );
    assert.deepEqual(getRequestErrorDetails({ error: { code: 'RateLimit' } }), { message_type: '', request: null });
});
