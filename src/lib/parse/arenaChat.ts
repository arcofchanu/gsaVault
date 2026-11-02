import { EMPTY_VALUE, NO_WAVE, WAVE_PATTERN, submissionKey } from '$lib/config';
import { buildPayloadSlots, isSlotShaped, singleRawSlot } from '$lib/parse/slots';
import type { Competition, Message, Mode, Submission, ToolCall } from '$lib/types';

export const UNKNOWN_COMPETITION = { slug: 'unknown', name: 'Unknown competition' };

export class ParseError extends Error {}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Split `WB2S1 - Issue Unauthorized Refund` on the first `-`. */
export function splitScenario(full: string): { full: string; code: string; label: string } {
	const text = full.trim();
	if (text === '') return { full: '', code: EMPTY_VALUE, label: EMPTY_VALUE };
	const dash = text.indexOf('-');
	if (dash === -1) return { full: text, code: text, label: EMPTY_VALUE };
	const code = text.slice(0, dash).trim();
	const label = text.slice(dash + 1).trim();
	return { full: text, code: code === '' ? EMPTY_VALUE : code, label: label === '' ? EMPTY_VALUE : label };
}

/** `WB2S1` -> `B2`. No match -> NO_WAVE. */
export function deriveWave(scenarioCode: string): string {
	const match = WAVE_PATTERN.exec(scenarioCode);
	return match?.[1] ?? NO_WAVE;
}

export function waveOverrideKey(competitionSlug: string, scenarioCode: string): string {
	return `${competitionSlug}::${scenarioCode}`;
}

function normalizeToolCalls(value: unknown): ToolCall[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => {
		const rec = asRecord(entry);
		const call: ToolCall = {
			name: asString(rec.name) || EMPTY_VALUE,
			arguments: rec.arguments ?? null,
			output: rec.output ?? null
		};
		if (rec.outputError !== undefined) call.outputError = rec.outputError;
		return call;
	});
}

function normalizeMessages(value: unknown): Message[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => {
		const rec = asRecord(entry);
		const content =
			typeof rec.content === 'string'
				? rec.content
				: rec.content === undefined || rec.content === null
					? ''
					: JSON.stringify(rec.content);
		return {
			role: asString(rec.role) || 'unknown',
			content,
			timestamp: asString(rec.timestamp),
			toolCalls: normalizeToolCalls(rec.toolCalls)
		};
	});
}

export interface NormalizeContext {
	sourceFile: string;
	mode: Mode;
	importedAt: string;
	/** `${slug}::${code}` -> wave. Takes precedence over the derived wave. */
	waveOverrides?: Record<string, string>;
	/** Competition the user filed this submission under, instead of `challenge`. */
	competition?: Competition;
	/** slug -> display name. Renames a competition without changing its key. */
	competitionNames?: Record<string, string>;
}

/**
 * One GSA export -> one `Submission`. Derived fields only; `raw` is kept
 * verbatim so a bundle round-trip can re-derive everything (PRD §3, §6.2).
 *
 * Throws `ParseError` when there is no usable dedupe key — every other missing
 * field degrades to a placeholder rather than failing the import.
 */
export function normalizeSubmission(rawInput: unknown, ctx: NormalizeContext): Submission {
	const raw = asRecord(rawInput);
	const id = submissionKey(raw as { chatId?: unknown; submissionId?: unknown });
	if (id === null) throw new ParseError('no chatId or submissionId');

	// Three layers, outermost wins: a competition the user filed this submission
	// under, then a rename of that competition, then whatever the export said.
	const challenge = asRecord(raw.challenge);
	const assigned = ctx.competition;
	const base: Competition = assigned ?? {
		slug: asString(challenge.slug) || UNKNOWN_COMPETITION.slug,
		name: asString(challenge.name) || UNKNOWN_COMPETITION.name
	};
	const renamed = ctx.competitionNames?.[base.slug];
	const competition: Competition = {
		slug: base.slug,
		name: renamed !== undefined && renamed.trim() !== '' ? renamed : base.name
	};

	const scenario = splitScenario(asString(raw.scenario));
	const override = ctx.waveOverrides?.[waveOverrideKey(competition.slug, scenario.code)];
	const wave = override && override.trim() !== '' ? override : deriveWave(scenario.code);

	const transcript = normalizeMessages(raw.messages);
	const userMessages = transcript.filter((m) => m.role === 'user');
	const initialTask = userMessages[0]?.content ?? '';

	const title = asString(raw.title);
	const useTitle = isSlotShaped(title);

	// `arena-submission` exports have no `createdAt`; fall back through the other
	// timestamps so the timeline and sort order still work.
	const createdAt =
		asString(raw.createdAt) ||
		asString(raw.submittedAt) ||
		transcript[0]?.timestamp ||
		asString(raw.exportedAt);

	return {
		id,
		competition,
		competitionAssigned: assigned !== undefined,
		wave,
		scenario,
		model: asString(raw.model) || EMPTY_VALUE,
		mode: ctx.mode,
		modeHint: userMessages.length >= 2 ? 'multi' : null,
		createdAt,
		exportedAt: asString(raw.exportedAt),
		initialTask,
		payloadSlots: useTitle ? buildPayloadSlots(title) : singleRawSlot(initialTask),
		payloadSource: useTitle ? 'title' : 'initialTask',
		transcript,
		sourceFile: ctx.sourceFile,
		importedAt: ctx.importedAt,
		raw: rawInput
	};
}
