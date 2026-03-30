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

/** Deterministic FNV-1a hash for a UTC date. Same date always yields same number. */
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

/** Check if today's UTC weekday is in the allowed set (cron weekday syntax). */
export function isAllowedWeekday(now: Date, weekdays: string): boolean {
    return expandCronField(weekdays, 0, 6).includes(now.getUTCDay());
}

/**
 * Compute a deterministic random delay in seconds for today, between 0 and maxSeconds.
 * Same date always produces the same delay.
 */
export function computeDelay(now: Date, maxSeconds: number): number {
    if (maxSeconds <= 0) return 0;
    const seed = hashDate(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    return seededInt(seed, 0, maxSeconds);
}

/** Parse WARMUP_MESSAGES env var (JSON array or plain string) into an array. */
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

/** Pick a message from the array using the daily seed. */
export function pickMessage(messages: string[], now: Date): string {
    if (messages.length <= 1) return messages[0];
    const seed = hashDate(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    return messages[seededInt(seed ^ 0x243f6a88, 0, messages.length - 1)];
}
