import { describe, expect, it } from 'vitest';
import { BUNDLE_SCHEMA } from '$lib/config';
import { buildBundle, bundleFilename, serializeBundle, toBundleEntry } from '$lib/export/bundle';
import { detect } from '$lib/parse/detect';
import { importSources } from '$lib/parse/import';
import { computeStats } from '$lib/stats';
import { EMPTY_PROFILE, type Profile } from '$lib/profile';
import { arenaFixture } from '$lib/testing/fixtures';
import { synthSource } from '$lib/testing/make';
import type { ImportOptions } from '$lib/parse/import';

const NOW = '2026-10-26T09:30:00.000Z';
const fixture = arenaFixture();

const emptyVault: ImportOptions = { mode: 'single', now: NOW, existing: {}, waveOverrides: {} };
const NO_PROFILE = EMPTY_PROFILE;

/** Build a small vault with a mix of modes and a wave override, as a user would. */
function seededVault() {
	const first = importSources([fixture, synthSource({ chatId: 'synth-1' })], emptyVault);
	const second = importSources([synthSource({ chatId: 'synth-2', userTurns: 2 })], {
		...emptyVault,
		mode: 'multi',
		existing: Object.fromEntries(first.added.map((s) => [s.id, s]))
	});
	const waveOverrides = { 'ipi-black-2026::WB2S4': 'C9' };
	// Re-derive with the override in force, exactly as the store does.
	const all = importSources(
		[fixture, synthSource({ chatId: 'synth-1' }), synthSource({ chatId: 'synth-2', userTurns: 2 })],
		{ ...emptyVault, waveOverrides }
	);
	const modes = new Map([
		...first.added.map((s) => [s.id, s.mode] as const),
		...second.added.map((s) => [s.id, s.mode] as const)
	]);
	const submissions = all.added.map((s) => ({ ...s, mode: modes.get(s.id) ?? s.mode }));
	return { submissions, waveOverrides, settings: { defaultMode: 'multi' as const } };
}

describe('bundle shape', () => {
	it('keeps only raw plus user-set fields per entry', () => {
		const s = seededVault().submissions[0];
		expect(Object.keys(toBundleEntry(s)).sort()).toEqual([
			'importedAt',
			'mode',
			'raw',
			'sourceFile'
		]);
	});

	it('stamps the schema and is self-identifying', () => {
		const { submissions, waveOverrides, settings } = seededVault();
		const bundle = buildBundle(submissions, waveOverrides, {}, NO_PROFILE, settings, NOW);
		expect(bundle.schema).toBe(BUNDLE_SCHEMA);
		expect(detect(JSON.parse(serializeBundle(bundle)))).toBe('vault-bundle');
	});

	it('exports only the overrides that apply to the exported submissions', () => {
		const { submissions, settings } = seededVault();
		const bundle = buildBundle(
			submissions.filter((s) => s.competition.slug === 'ipi-black-2026' && s.id.startsWith('synth')),
			{ 'ipi-black-2026::WB2S4': 'C9', 'other-comp::WX1S1': 'X1' },
			{},
			NO_PROFILE,
			settings,
			NOW
		);
		expect(bundle.waveOverrides).toEqual({});
	});

	it('names the file by export date', () => {
		expect(bundleFilename(NOW)).toBe('gsa-vault-2026-10-26.json');
	});
});

describe('round trip: export -> clear -> import', () => {
	const before = seededVault();
	const text = serializeBundle(
		buildBundle(before.submissions, before.waveOverrides, {}, NO_PROFILE, before.settings, NOW)
	);

	// A cleared vault importing the bundle, with the header toggle deliberately
	// set to the opposite of the stored modes to prove it does not interfere.
	const result = importSources([{ path: 'gsa-vault-2026-10-26.json', text }], {
		mode: 'single',
		now: '2099-01-01T00:00:00.000Z',
		existing: {},
		waveOverrides: {}
	});

	it('restores every submission', () => {
		expect(result.failed).toEqual([]);
		expect(result.added).toHaveLength(before.submissions.length);
		expect(result.added.map((s) => s.id).sort()).toEqual(
			before.submissions.map((s) => s.id).sort()
		);
	});

	it('restores wave overrides', () => {
		expect(result.waveOverrides).toEqual(before.waveOverrides);
		const restored = result.added.find((s) => s.scenario.code === 'WB2S4');
		expect(restored?.wave).toBe('C9');
	});

	it('restores per-submission modes, ignoring the header toggle', () => {
		const byId = new Map(result.added.map((s) => [s.id, s]));
		for (const original of before.submissions) {
			expect(byId.get(original.id)?.mode).toBe(original.mode);
		}
		expect(byId.get('synth-2')?.mode).toBe('multi');
	});

	it('restores settings', () => {
		expect(result.settings).toEqual({ defaultMode: 'multi' });
	});

	it('restores sourceFile and importedAt rather than stamping the import clock', () => {
		const byId = new Map(result.added.map((s) => [s.id, s]));
		for (const original of before.submissions) {
			expect(byId.get(original.id)?.sourceFile).toBe(original.sourceFile);
			expect(byId.get(original.id)?.importedAt).toBe(original.importedAt);
		}
	});

	it('produces an identical dashboard', () => {
		expect(computeStats(result.added)).toEqual(computeStats(before.submissions));
	});

	it('keeps raw byte-identical', () => {
		const byId = new Map(result.added.map((s) => [s.id, s]));
		for (const original of before.submissions) {
			expect(JSON.stringify(byId.get(original.id)?.raw)).toBe(JSON.stringify(original.raw));
		}
	});

	it('dedupes a bundle imported twice', () => {
		const existing = Object.fromEntries(result.added.map((s) => [s.id, s]));
		const again = importSources([{ path: 'again.json', text }], {
			mode: 'single',
			now: NOW,
			existing,
			waveOverrides: {}
		});
		expect(again.added).toHaveLength(0);
		expect(again.duplicates).toHaveLength(before.submissions.length);
	});

	it('reports an empty bundle as a failure', () => {
		const empty = serializeBundle(buildBundle([], {}, {}, NO_PROFILE, { defaultMode: 'single' }, NOW));
		const res = importSources([{ path: 'empty.json', text: empty }], emptyVault);
		expect(res.added).toHaveLength(0);
		expect(res.failed[0].reason).toMatch(/no submissions/);
	});
});
