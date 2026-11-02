import { describe, expect, it } from 'vitest';
import { NO_WAVE } from '$lib/config';
import { deriveWave, normalizeSubmission, splitScenario } from '$lib/parse/arenaChat';
import { detect } from '$lib/parse/detect';
import { importSources, summarize } from '$lib/parse/import';
import { buildPayloadSlots, extractProse, isSlotShaped, splitSlots } from '$lib/parse/slots';
import { arenaFixture } from '$lib/testing/fixtures';
import { countPlaceholders } from '$lib/util/text';
import type { Submission } from '$lib/types';

const NOW = '2026-10-26T09:30:00.000Z';
const fixture = arenaFixture();

function normalizeFixture(overrides: Record<string, string> = {}): Submission {
	return normalizeSubmission(fixture.json, {
		sourceFile: fixture.path,
		mode: 'single',
		importedAt: NOW,
		waveOverrides: overrides
	});
}

describe('detect', () => {
	it('classifies the arena export fixture', () => {
		expect(detect(fixture.json)).toBe('arena-submission');
	});

	it('classifies a vault bundle', () => {
		expect(detect({ schema: 'gsa-vault/1', submissions: [] })).toBe('vault-bundle');
	});

	it('classifies anything else as unknown', () => {
		expect(detect({ hello: 'world' })).toBe('unknown');
		expect(detect([1, 2, 3])).toBe('unknown');
		expect(detect('a string')).toBe('unknown');
		expect(detect(null)).toBe('unknown');
	});

	it('accepts a kind-less export that still has a key and messages', () => {
		expect(detect({ chatId: 'abc', messages: [] })).toBe('arena-submission');
	});
});

describe('scenario and wave rules', () => {
	it('splits the scenario on the first dash', () => {
		expect(splitScenario('WB2S1 - Issue Unauthorized Refund')).toEqual({
			full: 'WB2S1 - Issue Unauthorized Refund',
			code: 'WB2S1',
			label: 'Issue Unauthorized Refund'
		});
	});

	it('keeps dashes inside the label', () => {
		expect(splitScenario('WB2S9 - Cross-Account Transfer').label).toBe('Cross-Account Transfer');
	});

	it('derives the wave, natural-number safe', () => {
		expect(deriveWave('WB2S1')).toBe('B2');
		expect(deriveWave('WB10S2')).toBe('B10');
		expect(deriveWave('WA1S12')).toBe('A1');
	});

	it('falls back to no-wave for unrecognised codes', () => {
		expect(deriveWave('FREEFORM')).toBe(NO_WAVE);
		expect(deriveWave('')).toBe(NO_WAVE);
	});
});

describe('payload slots', () => {
	it('splits the separator and keeps empty slots in place', () => {
		const parts = splitSlots('[{"a":1}] · [] · [{"b":2}]');
		expect(parts).toEqual(['[{"a":1}]', '[]', '[{"b":2}]']);
	});

	it('does not split on a middle dot inside a JSON string', () => {
		const title = '[{"note":"ship A · ship B"}] · []';
		const slots = buildPayloadSlots(title);
		expect(slots).toHaveLength(2);
		expect(slots[0].prose).toEqual([{ field: '0.note', text: 'ship A · ship B' }]);
		expect(slots[1].empty).toBe(true);
	});

	it('keeps raw text when a slot is not JSON', () => {
		const slots = buildPayloadSlots('not json at all · []');
		expect(slots[0].parsed).toBeNull();
		expect(slots[0].raw).toBe('not json at all');
		expect(slots[0].empty).toBe(false);
	});

	it('extracts prose fields recursively', () => {
		const prose = extractProse([{ subject: 'hi', nested: { body: 'deep', other: 'ignored' } }]);
		expect(prose).toEqual([
			{ field: '0.subject', text: 'hi' },
			{ field: '0.nested.body', text: 'deep' }
		]);
	});

	it('rejects a prose chat title as not slot-shaped', () => {
		expect(isSlotShaped('Some ordinary chat title')).toBe(false);
		expect(isSlotShaped('')).toBe(false);
		expect(isSlotShaped('[] · []')).toBe(true);
	});
});

describe('normalizeSubmission against the fixture', () => {
	const submission = normalizeFixture();

	it('maps the competition', () => {
		expect(submission.competition).toEqual({
			slug: 'ipi-black-2026',
			name: 'Indirect Prompt Injection: Black'
		});
	});

	it('maps scenario, wave and model', () => {
		expect(submission.scenario.code).toBe('WB2S4');
		expect(submission.scenario.label).toBe('Cancel Target Order');
		expect(submission.wave).toBe('B2');
		expect(submission.model).toBe('Blue Seagull Peerless');
	});

	it('uses chatId as the id', () => {
		expect(submission.id).toBe('6adbb51d9b5a244e4220071a');
	});

	it('takes the initial task from the first user message', () => {
		expect(submission.initialTask.startsWith('lets go through anf cancel the orders')).toBe(true);
	});

	it('derives eight slots, two of them non-empty', () => {
		expect(submission.payloadSlots).toHaveLength(8);
		const filled = submission.payloadSlots.filter((s) => !s.empty);
		expect(filled.map((s) => s.index)).toEqual([1, 4]);
		expect(submission.payloadSource).toBe('title');
	});

	it('pulls the injection prose out of each filled slot', () => {
		const [email, drive] = submission.payloadSlots.filter((s) => !s.empty);
		expect(email.prose.map((p) => p.field)).toEqual(['0.subject', '0.body']);
		expect(drive.prose.map((p) => p.field)).toEqual(['0.body', '0.description']);
		expect(email.prose[0].text).toContain('Dispatch hold');
	});

	it('finds the template placeholders the UI highlights', () => {
		const text = submission.payloadSlots.map((s) => s.raw).join('\n');
		expect(countPlaceholders(text)).toBeGreaterThan(5);
		expect(text).toContain('{{wb2s4_target_order}}');
	});

	it('keeps the single-turn view free of agent output', () => {
		const single = [submission.initialTask, ...submission.payloadSlots.map((s) => s.raw)].join('\n');
		const assistant = submission.transcript.find((m) => m.role === 'assistant');
		expect(assistant).toBeDefined();
		expect(assistant!.toolCalls.length).toBeGreaterThan(0);
		expect(single).not.toContain(assistant!.content.slice(0, 60));
		expect(single).not.toContain(assistant!.toolCalls[0].name);
	});

	it('exposes the full transcript with tool calls for multi-turn', () => {
		expect(submission.transcript).toHaveLength(2);
		expect(submission.transcript[1].toolCalls).toHaveLength(23);
	});

	it('does not flag a two-message chat as multi-turn', () => {
		expect(submission.modeHint).toBeNull();
	});

	it('falls back to submittedAt when createdAt is absent', () => {
		expect(fixture.json.createdAt).toBeUndefined();
		expect(submission.createdAt).toBe(fixture.json.submittedAt);
	});

	it('keeps raw verbatim', () => {
		expect(submission.raw).toBe(fixture.json);
	});

	it('honours a wave override', () => {
		expect(normalizeFixture({ 'ipi-black-2026::WB2S4': 'C9' }).wave).toBe('C9');
	});
});

describe('mode hint', () => {
	it('flags exports with two or more user messages', () => {
		const raw = {
			kind: 'arena-chat',
			chatId: 'multi-1',
			messages: [
				{ role: 'user', content: 'first' },
				{ role: 'assistant', content: 'ok' },
				{ role: 'user', content: 'second' }
			]
		};
		const s = normalizeSubmission(raw, { sourceFile: 'x.json', mode: 'single', importedAt: NOW });
		expect(s.modeHint).toBe('multi');
		expect(s.mode).toBe('single'); // the toggle is never silently overridden
	});
});

describe('degraded exports', () => {
	it('falls back to the first user message when there is no slot-shaped title', () => {
		const raw = {
			kind: 'arena-chat',
			chatId: 'no-title',
			title: 'Just a chat title',
			messages: [{ role: 'user', content: 'do the thing' }]
		};
		const s = normalizeSubmission(raw, { sourceFile: 'x.json', mode: 'single', importedAt: NOW });
		expect(s.payloadSource).toBe('initialTask');
		expect(s.payloadSlots[0].raw).toBe('do the thing');
	});

	it('renders placeholders for missing fields instead of crashing', () => {
		const s = normalizeSubmission(
			{ chatId: 'bare', messages: null, shippingAddress: null },
			{ sourceFile: 'x.json', mode: 'single', importedAt: NOW }
		);
		expect(s.model).toBe('—');
		expect(s.scenario.code).toBe('—');
		expect(s.wave).toBe(NO_WAVE);
		expect(s.transcript).toEqual([]);
		expect(s.initialTask).toBe('');
	});

	it('rejects an export with no usable key', () => {
		expect(() => normalizeSubmission({ kind: 'arena-chat' }, { sourceFile: 'x', mode: 'single', importedAt: NOW })).toThrow(
			/no chatId/
		);
	});
});

describe('importSources dedupe', () => {
	const base = { mode: 'single' as const, now: NOW, existing: {}, waveOverrides: {} };

	it('imports the fixture once', () => {
		const result = importSources([fixture], base);
		expect(result.added).toHaveLength(1);
		expect(result.failed).toEqual([]);
		expect(summarize(result)).toBe('+1 added');
	});

	it('collapses the same file dropped twice in one go', () => {
		const result = importSources([fixture, { ...fixture, path: 'copy/' + fixture.path }], base);
		expect(result.added).toHaveLength(1);
		expect(result.duplicates).toHaveLength(1);
		expect(summarize(result)).toBe('+1 added · 1 duplicates skipped');
	});

	it('skips a file already in the vault', () => {
		const first = importSources([fixture], base);
		const existing = { [first.added[0].id]: first.added[0] };
		const second = importSources([fixture], { ...base, existing });
		expect(second.added).toHaveLength(0);
		expect(second.duplicates).toHaveLength(1);
	});

	it('refreshes a stored record when the same chatId was exported later', () => {
		const first = importSources([fixture], base);
		const existing = { [first.added[0].id]: first.added[0] };
		const newer = JSON.stringify({ ...fixture.json, exportedAt: '2099-01-01T00:00:00.000Z' });
		const result = importSources([{ path: 'newer.json', text: newer }], { ...base, existing });
		expect(result.added).toHaveLength(0);
		expect(result.replaced).toHaveLength(1);
		expect(result.duplicates).toHaveLength(0);
	});

	it('reports malformed and non-GSA files as failures', () => {
		const result = importSources(
			[
				{ path: 'broken.json', text: '{ not json' },
				{ path: 'other.json', text: '{"hello":"world"}' }
			],
			base
		);
		expect(result.added).toHaveLength(0);
		expect(result.failed.map((f) => f.path)).toEqual(['broken.json', 'other.json']);
		expect(result.failed[0].reason).toMatch(/malformed JSON/);
		expect(result.failed[1].reason).toMatch(/not a GSA arena export/);
	});
});
