import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ScheduleConfig {
    hours: number[];
    minutes: number[];
    weekdays: number[];
}

export interface ScheduleResult {
    execute: boolean;
    reason: string;
    targetHour: number;
    targetMinute: number;
}

/** Expand a single cron field (e.g. "1-5", "6,7,8", "*") into sorted integers. */
export function expandCronField(
    field: string,
    min: number,
    max: number
): number[] {
    if (field === "*") return sequence(min, max);

    const values = new Set<number>();
    for (const part of field.split(",")) {
        if (part.includes("/")) {
            const [range, stepStr] = part.split("/");
            const step = Number(stepStr);
            const [lo, hi] =
                range === "*" ? [min, max] : parseRangePart(range, min, max);
            for (let v = lo; v <= hi; v += step) values.add(v);
        } else if (part.includes("-")) {
            const [lo, hi] = parseRangePart(part, min, max);
            for (let v = lo; v <= hi; v++) values.add(v);
        } else {
            values.add(Number(part));
        }
    }
    return [...values].sort((a, b) => a - b);
}

function parseRangePart(
    part: string,
    min: number,
    max: number
): [number, number] {
    const [a, b] = part.split("-").map(Number);
    return [
        Number.isNaN(a) ? min : a,
        Number.isNaN(b) ? max : b,
    ];
}

function sequence(min: number, max: number): number[] {
    const arr: number[] = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
}

/**
 * Read the cron schedule from vercel.json and parse it into structured config.
 */
export function loadScheduleConfig(): ScheduleConfig {
    const raw = readFileSync(
        resolve(__dirname, "..", "vercel.json"),
        "utf-8"
    );
    const vercelConfig = JSON.parse(raw) as {
        crons?: Array<{ schedule?: string }>;
    };
    const schedule = vercelConfig.crons?.[0]?.schedule ?? "0 * * * *";
    return parseCronSchedule(schedule);
}

/**
 * Parse a 5-field cron expression into ScheduleConfig.
 * Fields: minute hour day-of-month month day-of-week
 */
export function parseCronSchedule(expression: string): ScheduleConfig {
    const fields = expression.trim().split(/\s+/);
    return {
        minutes: expandCronField(fields[0] ?? "*", 0, 59),
        hours: expandCronField(fields[1] ?? "*", 0, 23),
        weekdays: expandCronField(fields[4] ?? "*", 0, 6),
    };
}

/**
 * Deterministic hash for a UTC date. Same date always yields same number.
 */
function hashDate(year: number, month: number, day: number): number {
    let h = 2166136261;
    const s = `${year}-${month}-${day}`;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededInt(seed: number, min: number, max: number): number {
    if (min === max) return min;
    const range = max - min + 1;
    return min + (((seed % range) + range) % range);
}

/**
 * Pick today's random target hour and minute from the allowed values.
 */
export function dailyTargetTime(
    now: Date,
    config: ScheduleConfig
): { hour: number; minute: number } {
    const seed = hashDate(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    const hour = config.hours[seededInt(seed, 0, config.hours.length - 1)];
    const minute =
        config.minutes[seededInt(seed ^ 0x9e3779b9, 0, config.minutes.length - 1)];
    return { hour, minute };
}

/**
 * Parse WARMUP_MESSAGES env var (JSON array or plain string) into an array.
 */
export function parseMessages(
    raw: string | undefined,
    fallback: string
): string[] {
    if (!raw) return [fallback];
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
            const filtered = parsed.filter(
                (m): m is string => typeof m === "string" && m.length > 0
            );
            return filtered.length > 0 ? filtered : [fallback];
        }
        return [fallback];
    }
    return [trimmed];
}

/**
 * Pick a message from the array using the daily seed.
 */
export function pickMessage(messages: string[], now: Date): string {
    if (messages.length <= 1) return messages[0];
    const seed = hashDate(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    return messages[seededInt(seed ^ 0x243f6a88, 0, messages.length - 1)];
}

/**
 * Decide whether this cron invocation should send the warmup.
 */
export function shouldExecute(
    now: Date,
    config: ScheduleConfig
): ScheduleResult {
    const day = now.getUTCDay();
    if (!config.weekdays.includes(day)) {
        return {
            execute: false,
            reason: "day-of-week excluded",
            targetHour: -1,
            targetMinute: -1,
        };
    }

    const { hour: targetHour, minute: targetMinute } = dailyTargetTime(
        now,
        config
    );
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    if (currentHour !== targetHour) {
        return {
            execute: false,
            reason: `hour mismatch (target=${targetHour}, current=${currentHour})`,
            targetHour,
            targetMinute,
        };
    }

    if (currentMinute !== targetMinute) {
        return {
            execute: false,
            reason: `minute mismatch (target=${targetMinute}, current=${currentMinute})`,
            targetHour,
            targetMinute,
        };
    }

    return { execute: true, reason: "match", targetHour, targetMinute };
}
