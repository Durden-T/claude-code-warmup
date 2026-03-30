import { describe, expect, it } from "vitest";
import {
    computeDelay,
    expandCronField,
    isAllowedWeekday,
    parseMessages,
    pickMessage,
} from "./schedule";

describe("expandCronField", () => {
    it("expands wildcard to full range", () => {
        expect(expandCronField("*", 0, 6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("expands a range", () => {
        expect(expandCronField("6-9", 0, 23)).toEqual([6, 7, 8, 9]);
    });

    it("expands a list", () => {
        expect(expandCronField("1,3,5", 0, 6)).toEqual([1, 3, 5]);
    });

    it("expands step with wildcard", () => {
        expect(expandCronField("*/10", 0, 59)).toEqual([0, 10, 20, 30, 40, 50]);
    });

    it("expands step with range", () => {
        expect(expandCronField("0-30/10", 0, 59)).toEqual([0, 10, 20, 30]);
    });

    it("handles single value", () => {
        expect(expandCronField("5", 0, 23)).toEqual([5]);
    });

    it("handles mixed list and range", () => {
        expect(expandCronField("1,3-5,9", 0, 23)).toEqual([1, 3, 4, 5, 9]);
    });
});

describe("computeDelay", () => {
    it("returns 0 when maxSeconds is 0", () => {
        expect(computeDelay(new Date(Date.UTC(2026, 2, 15)), 0)).toBe(0);
    });

    it("returns 0 when maxSeconds is negative", () => {
        expect(computeDelay(new Date(Date.UTC(2026, 2, 15)), -10)).toBe(0);
    });

    it("returns value within range", () => {
        for (let d = 1; d <= 31; d++) {
            const delay = computeDelay(new Date(Date.UTC(2026, 2, d)), 240);
            expect(delay).toBeGreaterThanOrEqual(0);
            expect(delay).toBeLessThanOrEqual(240);
        }
    });

    it("is deterministic for the same date", () => {
        const a = computeDelay(new Date(Date.UTC(2026, 2, 15, 1, 0)), 240);
        const b = computeDelay(new Date(Date.UTC(2026, 2, 15, 23, 59)), 240);
        expect(a).toBe(b);
    });

    it("varies across different dates", () => {
        const delays = new Set<number>();
        for (let d = 1; d <= 30; d++) {
            delays.add(computeDelay(new Date(Date.UTC(2026, 2, d)), 240));
        }
        expect(delays.size).toBeGreaterThan(1);
    });
});

describe("isAllowedWeekday", () => {
    it("allows all days with wildcard", () => {
        for (let d = 22; d <= 28; d++) {
            expect(isAllowedWeekday(new Date(Date.UTC(2026, 2, d)), "*")).toBe(true);
        }
    });

    it("filters weekends with 1-5", () => {
        const saturday = new Date(Date.UTC(2026, 2, 28));
        expect(saturday.getUTCDay()).toBe(6);
        expect(isAllowedWeekday(saturday, "1-5")).toBe(false);
    });

    it("allows Monday with 1-5", () => {
        const monday = new Date(Date.UTC(2026, 2, 30));
        expect(monday.getUTCDay()).toBe(1);
        expect(isAllowedWeekday(monday, "1-5")).toBe(true);
    });

    it("filters Sunday with 1-5", () => {
        const sunday = new Date(Date.UTC(2026, 2, 29));
        expect(sunday.getUTCDay()).toBe(0);
        expect(isAllowedWeekday(sunday, "1-5")).toBe(false);
    });

    it("supports list syntax", () => {
        const wednesday = new Date(Date.UTC(2026, 2, 25));
        expect(wednesday.getUTCDay()).toBe(3);
        expect(isAllowedWeekday(wednesday, "1,3,5")).toBe(true);
        expect(isAllowedWeekday(wednesday, "2,4")).toBe(false);
    });
});

describe("parseMessages", () => {
    const fallback = "default msg";

    it("returns fallback when undefined", () => {
        expect(parseMessages(undefined, fallback)).toEqual([fallback]);
    });

    it("returns single string as array", () => {
        expect(parseMessages("hello", fallback)).toEqual(["hello"]);
    });

    it("parses JSON array", () => {
        expect(parseMessages('["a","b","c"]', fallback)).toEqual(["a", "b", "c"]);
    });

    it("filters empty strings from array", () => {
        expect(parseMessages('["a","","b"]', fallback)).toEqual(["a", "b"]);
    });

    it("returns fallback for empty array", () => {
        expect(parseMessages("[]", fallback)).toEqual([fallback]);
    });

    it("returns fallback for non-string array items", () => {
        expect(parseMessages("[1,2,3]", fallback)).toEqual([fallback]);
    });
});

describe("pickMessage", () => {
    it("returns the only message for single-element array", () => {
        expect(pickMessage(["only"], new Date(Date.UTC(2026, 0, 1)))).toBe("only");
    });

    it("is deterministic for the same date", () => {
        const msgs = ["a", "b", "c", "d", "e"];
        const d1 = new Date(Date.UTC(2026, 2, 15, 3, 0));
        const d2 = new Date(Date.UTC(2026, 2, 15, 18, 45));
        expect(pickMessage(msgs, d1)).toBe(pickMessage(msgs, d2));
    });

    it("varies across different dates", () => {
        const msgs = ["a", "b", "c", "d", "e", "f", "g", "h"];
        const picks = new Set<string>();
        for (let d = 1; d <= 30; d++) {
            picks.add(pickMessage(msgs, new Date(Date.UTC(2026, 2, d))));
        }
        expect(picks.size).toBeGreaterThan(1);
    });
});
