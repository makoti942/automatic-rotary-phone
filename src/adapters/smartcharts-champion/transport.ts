/**
 * Transport layer wrapper for SmartCharts Champion Adapter
 * Wraps the existing chart_api.api to match the TTransport interface
 */

import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import type { TTransport } from './types';

// Logger utility for transport layer
const logger = {
    log: () => {}, // Disabled in production
    warn: console.warn.bind(console, '[SmartCharts Transport]'),
    error: console.error.bind(console, '[SmartCharts Transport]'),
};

/**
 * Create transport wrapper around chart_api.api
 * @returns TTransport implementation
 */
export function createTransport(): TTransport {
    const subscriptions = new Map<string, any>();

    const unsubscribe = (subscriptionId: string) => {
        const subscription = subscriptions.get(subscriptionId);
        if (!subscription) return;

        subscription.messageSubscription?.unsubscribe();
        if (chart_api.api && subscription.realSubscriptionId) {
            chart_api.api.forget(subscription.realSubscriptionId);
        }
        subscriptions.delete(subscriptionId);
    };

    return {
        /**
         * Send one-shot API request
         */
        async send(request: any): Promise<any> {
            if (!chart_api.api) {
                await chart_api.init();
            }
            return chart_api.api.send(request);
        },

        /**
         * Subscribe to streaming data
         * @param request - API request with subscribe: 1
         * @param callback - Callback for streaming updates
         * @returns subscription ID
         */
        subscribe(request: any, callback: (response: any) => void): string {
            if (!chart_api.api) {
                throw new Error('Chart API not initialized');
            }
            // Generate a unique temporary ID for tracking
            const tempId = `temp-${Date.now()}-${Math.random()}`;

            // Send initial subscription request
            const subscribeRequest = { ...request, subscribe: 1 };

            // Set up global message listener first (before sending request)
            const messageSubscription = chart_api.api.onMessage()?.subscribe(({ data }: { data: any }) => {
                const subscriptionId = data?.subscription?.id;
                const storedSub = subscriptions.get(tempId);
                // Do not claim an ID from an unrelated socket message. The
                // subscription ID is assigned only from this request's send result.
                if (storedSub?.realSubscriptionId && subscriptionId === storedSub.realSubscriptionId) {
                    callback(data);
                }
            });

            // Store subscription info with temp ID
            subscriptions.set(tempId, {
                request: subscribeRequest,
                callback,
                messageSubscription,
                realSubscriptionId: null, // Will be set when we get the first response
            });

            // Send the subscription request
            chart_api.api
                .send(subscribeRequest)
                .then((response: any) => {
                    const subscriptionId = response?.subscription?.id;
                    const storedSub = subscriptions.get(tempId);

                    if (!subscriptionId) {
                        logger.error('No subscription ID in response:', response);
                        storedSub?.messageSubscription?.unsubscribe();
                        subscriptions.delete(tempId);
                        return;
                    }

                    // The view may have unmounted before the server acknowledged
                    // this request. Forget the late subscription instead of leaking it.
                    if (!storedSub) {
                        chart_api.api?.forget(subscriptionId);
                        return;
                    }

                    storedSub.realSubscriptionId = subscriptionId;
                    callback(response);
                })
                .catch((error: any) => {
                    logger.error('Subscription failed:', error);
                    // Clean up failed subscription
                    const storedSub = subscriptions.get(tempId);
                    if (storedSub?.messageSubscription) {
                        storedSub.messageSubscription.unsubscribe();
                    }
                    subscriptions.delete(tempId);
                });

            return tempId;
        },

        /**
         * Unsubscribe from streaming data
         * @param subscriptionId - Subscription ID to cancel (temp ID)
         */
        unsubscribe(subscriptionId: string): void {
            if (!subscriptions.has(subscriptionId)) logger.warn('No subscription found for ID:', subscriptionId);
            unsubscribe(subscriptionId);
        },

        /**
         * Unsubscribe from all streaming data of a specific type
         * @param msgType - Message type to unsubscribe from (optional)
         */
        unsubscribeAll(msgType?: string): void {
            const subscriptionIds = Array.from(subscriptions.entries())
                .filter(([, subscription]) => {
                    if (!msgType) return true;
                    const style = subscription.request?.style;
                    return style === msgType || (msgType === 'ticks' && !style);
                })
                .map(([subscriptionId]) => subscriptionId);
            subscriptionIds.forEach(unsubscribe);
        },
    };
}
