/**
 * Every tunable string/pattern the parser depends on lives here, so a change in
 * GSA's export shape is a one-file edit. PRD §2 calls this out explicitly for
 * the wave regex; the same discipline applies to the rest.
 */

/** `kind` values we treat as a single GSA submission export. */
export const ARENA_KINDS = ['arena-chat', 'arena-submission'] as const;

/** Round-trip bundle schema id (PRD §6.2). */
export const BUNDLE_SCHEMA = 'gsa-vault/1';

/**
 * Injection-slot separator in `title`: space, U+00B7 MIDDLE DOT, space.
 * Split is balance-aware (see parse/slots.ts) so a `·` inside a JSON string
 * never creates a false boundary.
 */
export const SLOT_SEPARATOR_CHAR = '·';

/**
 * `WB2S1` -> wave `B2`, scenario no. `1`. Lazy group 1 so `WB10S2` yields `B10`.
 * A guess at GSA's naming; overridable per scenario code in the UI.
 */
export const WAVE_PATTERN = /^W([A-Z0-9]+?)S(\d+)$/;

/** Displayed wave when the scenario code does not match WAVE_PATTERN. */
export const NO_WAVE = '—'; // em dash

/** Placeholder for any missing/null value in the UI and PDF. */
export const EMPTY_VALUE = '—';

/**
 * Keys whose string values carry the actual injection prose. Pulled out of the
 * parsed slot JSON and rendered as wrapped text (PRD §2 payload rule 4).
 */
export const PROSE_FIELDS = ['note', 'body', 'subject', 'description', 'content'] as const;

/**
 * Template placeholders highlighted in red, e.g. `{{attacker}}`, `{{org.name}}`.
 * Widened from the PRD's `[a-z_.]+` to include digits and uppercase: the real
 * fixture uses `{{wb2s4_target_order}}`, which the PRD pattern misses.
 */
export const PLACEHOLDER_PATTERN = /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/g;

/** Guard against pathological nesting while hunting for prose fields. */
export const PROSE_MAX_DEPTH = 8;

/** Slug prefix for competitions the user created by name rather than by export. */
export const CUSTOM_COMPETITION_PREFIX = 'custom-';

/**
 * Turn a typed competition name into a group key. Prefixed so a hand-made
 * competition can never silently collide with a real GSA challenge slug.
 */
export function slugifyCompetition(name: string): string {
	const base = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
	return `${CUSTOM_COMPETITION_PREFIX}${base === '' ? 'unnamed' : base}`;
}

/**
 * Dedupe key, per PRD §2 ("Dedupe key | chatId"). `arena-submission` exports
 * also carry a `submissionId`; switching the vault to one-record-per-submission
 * instead of one-per-chat is a change to this function alone.
 */
export function submissionKey(raw: { chatId?: unknown; submissionId?: unknown }): string | null {
	if (typeof raw.chatId === 'string' && raw.chatId.length > 0) return raw.chatId;
	if (typeof raw.submissionId === 'string' && raw.submissionId.length > 0) return raw.submissionId;
	return null;
}
