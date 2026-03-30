import type { VercelRequest, VercelResponse } from "@vercel/node";
import { computeDelay, isAllowedWeekday, parseMessages, pickMessage } from "./schedule";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const DEFAULT_WARMUP_MESSAGE =
    "Hello! This is an automated warm-up message to reset my Claude Code rate limit window. Please just say 'Warmed up!' in response.";

/**
 * Send a single warm-up message to the Claude API using a long-lived OAuth token.
 */
async function sendWarmupMessage(
    oauthToken: string,
    message: string
): Promise<string> {
    const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${oauthToken}`,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        },
        body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 64,
            messages: [{ role: "user", content: message }],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `Anthropic API error: ${response.status} ${response.statusText} — ${text}`
        );
    }

    const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
    };

    return data.content.find((b) => b.type === "text")?.text ?? "(no text)";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!oauthToken) {
        return res.status(500).json({
            error: "CLAUDE_CODE_OAUTH_TOKEN env var is not set. Run `claude setup-token` to generate a long-lived token.",
        });
    }

    const now = new Date();

    const weekdays = process.env.WARMUP_WEEKDAYS ?? "*";
    if (!isAllowedWeekday(now, weekdays)) {
        console.log(`[warmup] skipped: weekday ${now.getUTCDay()} not in "${weekdays}"`);
        return res.status(200).json({
            skipped: true,
            reason: "day-of-week excluded",
            timestamp: now.toISOString(),
        });
    }

    const maxDelay = Number(process.env.WARMUP_DELAY_MAX ?? "0");
    const delaySec = computeDelay(now, maxDelay);
    if (delaySec > 0) {
        console.log(`[warmup] sleeping ${delaySec}s before execution`);
        await sleep(delaySec * 1000);
    }

    const messages = parseMessages(
        process.env.WARMUP_MESSAGES ?? process.env.WARMUP_MESSAGE,
        DEFAULT_WARMUP_MESSAGE
    );
    const warmupMessage = pickMessage(messages, now);
    const timestamp = now.toISOString();

    try {
        const reply = await sendWarmupMessage(oauthToken, warmupMessage);

        console.log(`[warmup] done at ${timestamp} (delayed ${delaySec}s). Reply: "${reply}"`);

        return res.status(200).json({
            success: true,
            message: "Warmup sent successfully!",
            claudeReply: reply,
            delaySec,
            timestamp,
        });
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[warmup] error at ${timestamp}: ${error}`);
        return res.status(500).json({ success: false, error, timestamp });
    }
}
