// Keep the upstream behavior checks on Bun without a Node test runner.
import { expect } from 'bun:test';
const assert = Object.assign((value: unknown, message?: string) => { expect(!!value, message).toBe(true); }, {
 ok(value: unknown, message?: string) { expect(!!value, message).toBe(true); },
 equal(actual: unknown, expected: unknown, message?: string) { expect(actual, message).toBe(expected); },
 notEqual(actual: unknown, expected: unknown, message?: string) { expect(actual, message).not.toBe(expected); },
 deepEqual(actual: unknown, expected: unknown, message?: string) { expect(actual, message).toEqual(expected); },
 notDeepEqual(actual: unknown, expected: unknown, message?: string) { expect(actual, message).not.toEqual(expected); },
 match(actual: string, expected: RegExp) { expect(actual).toMatch(expected); },
 throws(fn: () => unknown, pattern?: RegExp) { pattern ? expect(fn).toThrow(pattern) : expect(fn).toThrow(); },
 async rejects(promise: Promise<unknown>, pattern?: RegExp) { if (pattern) await expect(promise).rejects.toThrow(pattern); else await expect(promise).rejects.toThrow(); }
});
export default assert;
