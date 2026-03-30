import { describe, expect, it } from "vitest";
import {
    dailyTargetTime,
    expandCronField,
    parseMessages,
    parseCronSchedule,
    pickMessage,
    shouldExecute,
    type ScheduleConfig,
} from "./schedule";

const workdayConfig: ScheduleConfig = parseCronSchedule("0 6-9 * * 1-5");

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

describe("parseCronSchedule", () => {
    it("parses workday schedule", () => {
        const config = parseCronSchedule("0 6-9 * * 1-5");
        expect(config.minutes).toEqual([0]);
        expect(config.hours).toEqual([6, 7, 8, 9]);
        expect(config.weekdays).toEqual([1, 2, 3, 4, 5]);
    });

    it("parses every-10-min schedule", () => {
        const config = parseCronSchedule("*/10 * * * *");
        expect(config.minutes).toEqual([0, 10, 20, 30, 40, 50]);
        expect(config.hours.length).toBe(24);
        expect(config.weekdays.length).toBe(7);
    });
});

describe("dailyTargetTime", () => {
    it("returns values within configured sets", () => {
        for (let d = 1; d <= 31; d++) {
            const now = new Date(Date.UTC(2026, 2, d, 0, 0));
            const { hour, minute } = dailyTargetTime(now, workdayConfig);
            expect(workdayConfig.hours).toContain(hour);
            expect(workdayConfig.minutes).toContain(minute);
        }
    });

    it("is deterministic for the same date", () => {
        const a = dailyTargetTime(new Date(Date.UTC(2026, 2, 15, 8, 0)), workdayConfig);
        const b = dailyTargetTime(new Date(Date.UTC(2026, 2, 15, 9, 30)), workdayConfig);
        expect(a).toEqual(b);
    });

    it("varies across different dates", () => {
        const config = parseCronSchedule("0 6-9 * * *");
        const results = new Set<string>();
        for (let d = 1; d <= 30; d++) {
            const { hour, minute } = dailyTargetTime(
                new Date(Date.UTC(2026, 2, d, 0, 0)),
                config
            );
            results.add(`${hour}:${minute}`);
        }
        expect(results.size).toBeGreaterThan(1);
    });

    it("returns exact value when only one option", () => {
        const config = parseCronSchedule("15 7 * * *");
        const { hour, minute } = dailyTargetTime(new Date(Date.UTC(2026, 0, 1)), config);
        expect(hour).toBe(7);
        expect(minute).toBe(15);
    });
});

describe("shouldExecute", () => {
    it("skips weekends with workday config", () => {
        const saturday = new Date(Date.UTC(2026, 2, 28, 7, 0));
        expect(saturday.getUTCDay()).toBe(6);
        const result = shouldExecute(saturday, workdayConfig);
        expect(result.execute).toBe(false);
        expect(result.reason).toBe("day-of-week excluded");
    });

    it("skips Sunday with workday config", () => {
        const sunday = new Date(Date.UTC(2026, 2, 29, 7, 0));
        expect(sunday.getUTCDay()).toBe(0);
        expect(shouldExecute(sunday, workdayConfig).execute).toBe(false);
    });

    it("allows weekends with wildcard weekday", () => {
        const config = parseCronSchedule("0 6-9 * * *");
        const saturday = new Date(Date.UTC(2026, 2, 28, 0, 0));
        const { hour, minute } = dailyTargetTime(saturday, config);
        const atTarget = new Date(Date.UTC(2026, 2, 28, hour, minute));
        expect(shouldExecute(atTarget, config).execute).toBe(true);
    });

    it("skips when hour does not match target", () => {
        const monday = new Date(Date.UTC(2026, 2, 30, 0, 0));
        const { hour } = dailyTargetTime(monday, workdayConfig);
        const wrongHour = hour === 6 ? 9 : 6;
        const now = new Date(Date.UTC(2026, 2, 30, wrongHour, 0));
        const result = shouldExecute(now, workdayConfig);
        expect(result.execute).toBe(false);
        expect(result.reason).toContain("hour mismatch");
    });

    it("skips when minute does not match target", () => {
        const monday = new Date(Date.UTC(2026, 2, 30, 0, 0));
        const { hour, minute } = dailyTargetTime(monday, workdayConfig);
        const wrongMinute = minute === 0 ? 30 : 0;
        const now = new Date(Date.UTC(2026, 2, 30, hour, wrongMinute));
        const result = shouldExecute(now, workdayConfig);
        if (wrongMinute !== minute) {
            expect(result.execute).toBe(false);
            expect(result.reason).toContain("minute mismatch");
        }
    });

    it("executes when time matches exactly", () => {
        const monday = new Date(Date.UTC(2026, 2, 30, 0, 0));
        const { hour, minute } = dailyTargetTime(monday, workdayConfig);
        const now = new Date(Date.UTC(2026, 2, 30, hour, minute));
        expect(shouldExecute(now, workdayConfig).execute).toBe(true);
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
