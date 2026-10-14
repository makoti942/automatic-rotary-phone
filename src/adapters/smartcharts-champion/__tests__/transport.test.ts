/**
 * Unit tests for Transport Layer
 * Tests the transport wrapper around chart_api
 */

import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { createTransport } from '../transport';

// Mock chart_api
jest.mock('@/external/bot-skeleton/services/api/chart-api', () => ({
    __esModule: true,
    default: {
        api: null,
        init: jest.fn(),
    },
}));

describe('Transport Layer', () => {
    let mockApi: any;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock API with RxJS-like observable
        mockApi = {
            send: jest.fn(),
            onMessage: jest.fn(),
            forget: jest.fn(),
            forgetAll: jest.fn(),
        };

        // Set up chart_api.api
        chart_api.api = mockApi;
    });

    afterEach(() => {
        chart_api.api = null;
    });

    describe('createTransport', () => {
        it('should create transport instance', () => {
            const transport = createTransport();

            expect(transport).toBeDefined();
            expect(transport.send).toBeInstanceOf(Function);
            expect(transport.subscribe).toBeInstanceOf(Function);
            expect(transport.unsubscribe).toBeInstanceOf(Function);
            expect(transport.unsubscribeAll).toBeInstanceOf(Function);
        });
    });

    describe('send', () => {
        it('should send API request', async () => {
            const mockResponse = { tick: { quote: 100.5 } };
            mockApi.send.mockResolvedValue(mockResponse);

            const transport = createTransport();
            const request = { ticks: 'R_50' };

            const result = await transport.send(request);

            expect(mockApi.send).toHaveBeenCalledWith(request);
            expect(result).toEqual(mockResponse);
        });

        it('should initialize API if not available', async () => {
            chart_api.api = null;
            const mockResponse = { tick: { quote: 100.5 } };

            (chart_api.init as jest.Mock).mockResolvedValue(undefined);

            // After init, set up the API
            (chart_api.init as jest.Mock).mockImplementation(() => {
                chart_api.api = mockApi;
                mockApi.send.mockResolvedValue(mockResponse);
                return Promise.resolve();
            });

            const transport = createTransport();
            const request = { ticks: 'R_50' };

            const result = await transport.send(request);

            expect(chart_api.init).toHaveBeenCalled();
            expect(result).toEqual(mockResponse);
        });

        it('should handle send errors', async () => {
            const error = new Error('Network error');
            mockApi.send.mockRejectedValue(error);

            const transport = createTransport();
            const request = { ticks: 'R_50' };

            await expect(transport.send(request)).rejects.toThrow('Network error');
        });
    });

    describe('subscribe', () => {
        it('should subscribe to streaming data', () => {
            const mockSubscription = {
                unsubscribe: jest.fn(),
            };

            const mockMessageObservable = {
                subscribe: jest.fn().mockReturnValue(mockSubscription),
            };

            mockApi.onMessage.mockReturnValue(mockMessageObservable);
            mockApi.send.mockResolvedValue({
                subscription: { id: 'sub-123' },
                tick: { quote: 100.5 },
            });

            const transport = createTransport();
            const callback = jest.fn();
            const request = { ticks: 'R_50', subscribe: 1 };

            const subscriptionId = transport.subscribe(request, callback);

            expect(subscriptionId).toBeDefined();
            expect(typeof subscriptionId).toBe('string');
            expect(mockApi.onMessage).toHaveBeenCalled();
            expect(mockMessageObservable.subscribe).toHaveBeenCalled();
        });

        it('should throw error if API not initialized', () => {
            chart_api.api = null;

            const transport = createTransport();
            const callback = jest.fn();
            const request = { ticks: 'R_50', subscribe: 1 };

            expect(() => transport.subscribe(request, callback)).toThrow('Chart API not initialized');
        });

        it('should handle subscription with callback', done => {
            const mockSubscription = {
                unsubscribe: jest.fn(),
            };

            let messageCallback: any;
            const mockMessageObservable = {
                subscribe: jest.fn((cb: any) => {
                    messageCallback = cb;
                    return mockSubscription;
                }),
            };

            mockApi.onMessage.mockReturnValue(mockMessageObservable);
            mockApi.send.mockResolvedValue({
                subscription: { id: 'sub-123' },
                tick: { quote: 100.5 },
            });

            const transport = createTransport();
            const callback = jest.fn();
            const request = { ticks: 'R_50', subscribe: 1 };

            transport.subscribe(request, callback);

            // Wait for async send to complete
            setTimeout(() => {
                // Simulate incoming message
                messageCallback({
                    data: {
                        subscription: { id: 'sub-123' },
                        tick: { quote: 101.0 },
                    },
                });

                expect(callback).toHaveBeenCalledWith({
                    subscription: { id: 'sub-123' },
                    tick: { quote: 101.0 },
                });
                done();
            }, 100);
        });

        it('does not claim another stream ID before its own request is acknowledged', async () => {
            const messageCallbacks: Array<(message: any) => void> = [];
            const resolveRequests: Array<(response: any) => void> = [];
            mockApi.onMessage.mockImplementation(() => ({
                subscribe: (callback: (message: any) => void) => {
                    messageCallbacks.push(callback);
                    return { unsubscribe: jest.fn() };
                },
            }));
            mockApi.send.mockImplementation(
                () => new Promise(resolve => resolveRequests.push(resolve))
            );

            const transport = createTransport();
            const firstCallback = jest.fn();
            const secondCallback = jest.fn();
            transport.subscribe({ ticks_history: 'R_50', style: 'ticks' }, firstCallback);
            transport.subscribe({ ticks_history: 'R_100', style: 'ticks' }, secondCallback);

            messageCallbacks[0]({ data: { subscription: { id: 'sub-second' }, tick: { quote: 99 } } });
            expect(firstCallback).not.toHaveBeenCalled();

            resolveRequests[0]({ subscription: { id: 'sub-first' }, tick: { quote: 100 } });
            resolveRequests[1]({ subscription: { id: 'sub-second' }, tick: { quote: 99 } });
            await Promise.resolve();
            await Promise.resolve();

            expect(firstCallback).toHaveBeenCalledWith({ subscription: { id: 'sub-first' }, tick: { quote: 100 } });
            expect(secondCallback).toHaveBeenCalledWith({ subscription: { id: 'sub-second' }, tick: { quote: 99 } });
        });

        it('should handle subscription errors', done => {
            const mockSubscription = {
                unsubscribe: jest.fn(),
            };

            const mockMessageObservable = {
                subscribe: jest.fn().mockReturnValue(mockSubscription),
            };

            mockApi.onMessage.mockReturnValue(mockMessageObservable);
            mockApi.send.mockRejectedValue(new Error('Subscription failed'));

            const transport = createTransport();
            const callback = jest.fn();
            const request = { ticks: 'R_50', subscribe: 1 };

            const subscriptionId = transport.subscribe(request, callback);

            expect(subscriptionId).toBeDefined();

            // Wait for error handling
            setTimeout(() => {
                expect(mockSubscription.unsubscribe).toHaveBeenCalled();
                done();
            }, 100);
        });
    });

    describe('unsubscribe', () => {
        it('should unsubscribe from streaming data', () => {
            const mockSubscription = {
                unsubscribe: jest.fn(),
            };

            const mockMessageObservable = {
                subscribe: jest.fn().mockReturnValue(mockSubscription),
            };

            mockApi.onMessage.mockReturnValue(mockMessageObservable);
            mockApi.send.mockResolvedValue({
                subscription: { id: 'sub-123' },
            });

            const transport = createTransport();
            const callback = jest.fn();
            const request = { ticks: 'R_50', subscribe: 1 };

            const subscriptionId = transport.subscribe(request, callback);

            // Wait for subscription to be set up
            setTimeout(() => {
                transport.unsubscribe(subscriptionId);

                expect(mockSubscription.unsubscribe).toHaveBeenCalled();
                expect(mockApi.forget).toHaveBeenCalledWith('sub-123');
            }, 100);
        });

        it('should handle unsubscribe for non-existent subscription', () => {
            const transport = createTransport();

            // Should not throw
            expect(() => transport.unsubscribe('non-existent-id')).not.toThrow();
        });
    });

    describe('unsubscribeAll', () => {
        it('should forget only subscriptions owned by this transport', async () => {
            const mockSubscription = { unsubscribe: jest.fn() };
            mockApi.onMessage.mockReturnValue({ subscribe: jest.fn().mockReturnValue(mockSubscription) });
            mockApi.send.mockResolvedValue({ subscription: { id: 'owned-sub' } });
            const transport = createTransport();
            const otherTransport = createTransport();

            transport.subscribe({ ticks_history: 'R_50', style: 'ticks' }, jest.fn());
            otherTransport.subscribe({ ticks_history: 'R_100', style: 'ticks' }, jest.fn());
            await Promise.resolve();
            await Promise.resolve();
            transport.unsubscribeAll();

            expect(mockApi.forget).toHaveBeenCalledTimes(1);
            expect(mockApi.forget).toHaveBeenCalledWith('owned-sub');
            expect(mockApi.forgetAll).not.toHaveBeenCalled();
            expect(mockSubscription.unsubscribe).toHaveBeenCalledTimes(1);
        });

        it('should unsubscribe only the requested quote style', async () => {
            const mockSubscription = { unsubscribe: jest.fn() };
            mockApi.onMessage.mockReturnValue({ subscribe: jest.fn().mockReturnValue(mockSubscription) });
            mockApi.send
                .mockResolvedValueOnce({ subscription: { id: 'tick-sub' } })
                .mockResolvedValueOnce({ subscription: { id: 'candle-sub' } });
            const transport = createTransport();
            transport.subscribe({ ticks_history: 'R_50', style: 'ticks' }, jest.fn());
            transport.subscribe({ ticks_history: 'R_50', style: 'candles', granularity: 60 }, jest.fn());
            await Promise.resolve();
            await Promise.resolve();

            transport.unsubscribeAll('candles');

            expect(mockApi.forget).toHaveBeenCalledTimes(1);
            expect(mockApi.forget).toHaveBeenCalledWith('candle-sub');
            expect(mockApi.forgetAll).not.toHaveBeenCalled();
        });

        it('should handle unsubscribeAll when API not available', () => {
            chart_api.api = null;

            const transport = createTransport();

            // Should not throw
            expect(() => transport.unsubscribeAll()).not.toThrow();
        });
    });
});
