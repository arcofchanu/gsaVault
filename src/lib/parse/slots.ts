import { PROSE_FIELDS, PROSE_MAX_DEPTH, SLOT_SEPARATOR_CHAR } from '$lib/config';
import type { PayloadSlot, ProseField } from '$lib/types';

const NAIVE_SEPARATOR = ` ${SLOT_SEPARATOR_CHAR} `;
const PROSE_KEYS: readonly string[] = PROSE_FIELDS;

type ParseOutcome = { ok: true; value: unknown } | { ok: false };

function tryParse(text: string): ParseOutcome {
	const trimmed = text.trim();
	if (trimmed === '') return { ok: false };
	try {
		return { ok: true, value: JSON.parse(trimmed) as unknown };
	} catch {
		return { ok: false };
	}
}

/** `[]` or blank text — an injection surface that was left unused. */
export function isEmptySlotText(text: string): boolean {
	const trimmed = text.trim();
	return trimmed === '' || trimmed === '[]';
}

/** A slot is well-formed if it is empty or parses as JSON. */
function slotIsWellFormed(text: string): boolean {
	return isEmptySlotText(text) || tryParse(text).ok;
}

function wellFormedCount(parts: string[]): number {
	return parts.reduce((n, p) => n + (slotIsWellFormed(p) ? 1 : 0), 0);
}

/**
 * Split on `·` only at JSON top level, skipping separators that sit inside a
 * string or inside brackets. This is the retry path from PRD §7 ("`title` slots
 * containing `·` inside JSON strings"): scan balanced brackets instead of
 * splitting blindly.
 */
function splitSlotsBalanced(title: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let inString = false;
	let escaped = false;
	let start = 0;

	for (let i = 0; i < title.length; i++) {
		const ch = title[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '[' || ch === '{') {
			depth++;
		} else if (ch === ']' || ch === '}') {
			depth = Math.max(0, depth - 1);
		} else if (depth === 0 && ch === SLOT_SEPARATOR_CHAR) {
			// The PRD separator is " · " — require whitespace (or an edge) on both
			// sides so a bare middle dot in prose is not treated as a boundary.
			const before = i > 0 ? title[i - 1] : undefined;
			const after = i + 1 < title.length ? title[i + 1] : undefined;
			const okBefore = before === undefined || /\s/.test(before);
			const okAfter = after === undefined || /\s/.test(after);
			if (okBefore && okAfter) {
				parts.push(title.slice(start, i));
				start = i + 1;
			}
		}
	}
	parts.push(title.slice(start));
	return parts.map((p) => p.trim());
}

/**
 * PRD §2 payload rule 1, with the rule-from-§7 retry: split on " · ", verify
 * every part is `[]` or parseable, and fall back to a balanced-bracket scan if
 * not. If neither split is fully well-formed, keep whichever yielded more
 * well-formed slots (ties go to the plain split).
 */
export function splitSlots(title: string): string[] {
	const naive = title.split(NAIVE_SEPARATOR).map((p) => p.trim());
	if (naive.every(slotIsWellFormed)) return naive;

	const balanced = splitSlotsBalanced(title);
	if (balanced.every(slotIsWellFormed)) return balanced;

	return wellFormedCount(balanced) > wellFormedCount(naive) ? balanced : naive;
}

/**
 * Depth-first hunt for the string fields that carry injection prose. Paths are
 * dotted (`items.0.note`) so the UI can label where each block came from.
 */
function collectProse(value: unknown, out: ProseField[], path: string, depth: number): void {
	if (depth > PROSE_MAX_DEPTH || value === null || typeof value !== 'object') return;

	if (Array.isArray(value)) {
		value.forEach((item, i) => {
			collectProse(item, out, path === '' ? String(i) : `${path}.${i}`, depth + 1);
		});
		return;
	}

	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const childPath = path === '' ? key : `${path}.${key}`;
		if (typeof child === 'string') {
			if (PROSE_KEYS.includes(key) && child.trim() !== '') {
				out.push({ field: childPath, text: child });
			}
		} else {
			collectProse(child, out, childPath, depth + 1);
		}
	}
}

export function extractProse(parsed: unknown): ProseField[] {
	const out: ProseField[] = [];
	collectProse(parsed, out, '', 0);
	return out;
}

function toSlot(raw: string, index: number): PayloadSlot {
	const empty = isEmptySlotText(raw);
	if (empty) return { index, raw, empty: true, parsed: null, prose: [] };
	const outcome = tryParse(raw);
	const parsed = outcome.ok ? outcome.value : null;
	return { index, raw, empty: false, parsed, prose: outcome.ok ? extractProse(parsed) : [] };
}

/**
 * True when `title` actually looks like injection slots rather than a prose
 * chat title. At least one part must be an empty slot or valid JSON.
 */
export function isSlotShaped(title: string): boolean {
	if (title.trim() === '') return false;
	const parts = splitSlots(title);
	return parts.some((p) => slotIsWellFormed(p));
}

/** PRD §2 payload rule: `title` -> ordered, 1-based injection slots. */
export function buildPayloadSlots(title: string): PayloadSlot[] {
	return splitSlots(title).map((raw, i) => toSlot(raw, i + 1));
}

/** Rule 6 fallback: no slot-shaped title, so the payload is the user's ask. */
export function singleRawSlot(text: string): PayloadSlot[] {
	return [toSlot(text, 1)];
}
