import { isBuiltInBot, isBuiltInBotName, isBuiltInBotSource } from '../bot-classification';

describe('built-in bot classification', () => {
    it('recognizes Reverse D’Alembert name variants', () => {
        expect(isBuiltInBotName("Reverse D'Alembert")).toBe(true);
        expect(isBuiltInBotName('Reverse_Dalembert_Bot')).toBe(true);
        expect(isBuiltInBotName('My Reverse D’Alembert Bot')).toBe(false);
    });

    it('recognizes stock XML and hashed JavaScript chunk sources on any host', () => {
        expect(isBuiltInBotSource('https://legacyprime.live/static/js/async/reverse_dalembert-xml.78606053.js')).toBe(true);
        expect(isBuiltInBotSource('https://example.org/xml/reverse_dalembert.xml')).toBe(true);
        expect(isBuiltInBotSource('embedded:https://example.org/static/js/async/accumulators_reverse_dalembert-xml.933f6e64.js')).toBe(true);
    });

    it('does not classify a custom bot just because its name contains a built-in strategy', () => {
        expect(isBuiltInBotSource('https://example.org/free-bots/my-reverse-dalembert-system.xml')).toBe(false);
        expect(isBuiltInBot({ name: 'My Reverse D’Alembert Bot', source: 'https://example.org/my-custom-system.xml' })).toBe(false);
    });

    it('recognizes other stock templates shipped by Deriv', () => {
        expect(isBuiltInBotName('accumulators_reverse_martingale_on_stat_reset')).toBe(true);
        expect(isBuiltInBotName('Oscar’s Grind Max Stake')).toBe(true);
        expect(isBuiltInBotName('Apex AI V3')).toBe(false);
    });
});
