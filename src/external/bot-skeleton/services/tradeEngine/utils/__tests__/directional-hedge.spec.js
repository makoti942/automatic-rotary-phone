import { getConfirmedTickDirection } from '../directional-hedge';

describe('getConfirmedTickDirection', () => {
    it('requires three consecutive upward movements', () => {
        expect(getConfirmedTickDirection([100, 101, 102, 103])).toBe('rise');
    });

    it('requires three consecutive downward movements', () => {
        expect(getConfirmedTickDirection([103, 102, 101, 100])).toBe('fall');
    });

    it('does not confirm a mixed-direction sequence', () => {
        expect(getConfirmedTickDirection([100, 101, 100, 102])).toBe('');
    });

    it('does not confirm an equal-price movement', () => {
        expect(getConfirmedTickDirection([100, 101, 101, 102])).toBe('');
    });

    it('requires at least four quotes for three movements', () => {
        expect(getConfirmedTickDirection([100, 101, 102])).toBe('');
    });

    it('rejects non-numeric quotes', () => {
        expect(getConfirmedTickDirection([100, 101, 'bad', 103])).toBe('');
    });
});
