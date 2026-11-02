import { PLACEHOLDER_PATTERN } from '$lib/config';

export interface TextSegment {
	text: string;
	placeholder: boolean;
}

/**
 * Split text into plain and `{{placeholder}}` runs so both the DOM and the PDF
 * can colour placeholders red from one source of truth (PRD §2 rule 5).
 */
export function splitPlaceholders(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	// Fresh regex each call: PLACEHOLDER_PATTERN is global, so lastIndex is shared state.
	const re = new RegExp(PLACEHOLDER_PATTERN.source, 'g');
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		if (match.index > last) segments.push({ text: text.slice(last, match.index), placeholder: false });
		segments.push({ text: match[0], placeholder: true });
		last = match.index + match[0].length;
		if (match[0].length === 0) re.lastIndex++; // belt-and-braces against a zero-width match
	}
	if (last < text.length) segments.push({ text: text.slice(last), placeholder: false });
	return segments;
}

export function countPlaceholders(text: string): number {
	return splitPlaceholders(text).filter((s) => s.placeholder).length;
}

/** Stable, readable pretty-print for parsed slot JSON. */
export function prettyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Short form of a chatId for meta lines: first 8 chars. */
export function shortId(id: string): string {
	return id.length > 8 ? id.slice(0, 8) : id;
}

export function formatDate(iso: string): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '—';
	return new Date(t).toISOString().slice(0, 10);
}

export function formatDateTime(iso: string): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '—';
	return new Date(t).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}
