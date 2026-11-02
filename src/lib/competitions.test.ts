import { describe, expect, it } from 'vitest';
import {
	listCompetitions,
	mergeCompetitions,
	planWaveMove,
	readCompetitionList,
	resolveNewCompetition
} from '$lib/competitions';
import { buildBundle } from '$lib/export/bundle';
import { importSources } from '$lib/parse/import';
import { EMPTY_PROFILE } from '$lib/profile';
import { synth, synthSource } from '$lib/testing/make';

const A = { slug: 'ipi-black-2026', name: 'IPI Black' };
const B = { slug: 'custom-sweep', name: 'Sweep' };

const subs = [
	synth({ chatId: 'a1', slug: A.slug, name: A.name, scenario: 'WB2S1 - Refund' }),
	synth({ chatId: 'a2', slug: A.slug, name: A.name, scenario: 'WB2S4 - Cancel' }),
	synth({ chatId: 'a3', slug: A.slug, name: A.name, scenario: 'WB3S1 - Other' })
];

describe('listCompetitions', () => {
	it('lists empty registered competitions next to ones with submissions', () => {
		const list = listCompetitions(subs, [B], {});
		expect(list.map((c) => c.slug)).toEqual([A.slug, B.slug]);
	});

	it('applies renames to registered competitions', () => {
		const list = listCompetitions([], [B], { [B.slug]: 'Wave 3 Sweep' });
		expect(list).toEqual([{ slug: B.slug, name: 'Wave 3 Sweep' }]);
	});

	it('does not list a competition twice', () => {
		expect(listCompetitions(subs, [A, A], {})).toHaveLength(1);
	});
});

describe('resolveNewCompetition', () => {
	it('makes a new custom competition', () => {
		expect(resolveNewCompetition('  Wave 3 Sweep ', [A])).toEqual({
			competition: { slug: 'custom-wave-3-sweep', name: 'Wave 3 Sweep' },
			created: true
		});
	});

	it('reuses an existing competition with the same name', () => {
		expect(resolveNewCompetition('ipi black', [A])).toEqual({ competition: A, created: false });
	});

	it('never reuses a taken slug', () => {
		const taken = { slug: 'custom-sweep', name: 'Something else' };
		expect(resolveNewCompetition('Sweep', [taken])?.competition.slug).toBe('custom-sweep-2');
	});

	it('refuses a blank name', () => {
		expect(resolveNewCompetition('   ', [])).toBeNull();
	});
});

describe('planWaveMove', () => {
	it('moves every submission of the wave and nothing else', () => {
		const plan = planWaveMove(subs, {}, A.slug, 'B2', B);
		expect(Object.keys(plan.assign).sort()).toEqual(['a1', 'a2']);
		expect(plan.assign.a1).toEqual(B);
	});

	it('is a no-op onto the same competition', () => {
		expect(planWaveMove(subs, {}, A.slug, 'B2', A).assign).toEqual({});
	});

	it('carries a hand-set wave across and drops the stale override', () => {
		// a3 (WB3S1) was put in wave B2 by hand.
		const moved = synth({ chatId: 'a3', slug: A.slug, name: A.name, scenario: 'WB3S1 - Other' });
		const withOverride = [subs[0]!, subs[1]!, { ...moved, wave: 'B2' }];
		const plan = planWaveMove(withOverride, { [`${A.slug}::WB3S1`]: 'B2' }, A.slug, 'B2', B);
		expect(plan.assign.a3).toEqual(B);
		expect(plan.waveOverrides).toEqual({ [`${B.slug}::WB3S1`]: 'B2' });
	});

	it('keeps the old override while another submission still uses it', () => {
		const left = { ...synth({ chatId: 'x', slug: A.slug, name: A.name, scenario: 'WB3S1 - Other' }), wave: 'B9' };
		const moving = { ...synth({ chatId: 'y', slug: A.slug, name: A.name, scenario: 'WB3S1 - Other' }), wave: 'B2' };
		const key = `${A.slug}::WB3S1`;
		const plan = planWaveMove([left, moving], { [key]: 'B2' }, A.slug, 'B2', B);
		expect(plan.waveOverrides[key]).toBe('B2');
		expect(plan.waveOverrides[`${B.slug}::WB3S1`]).toBe('B2');
	});
});

describe('competitions in a bundle', () => {
	it('carries empty competitions through export and re-import', () => {
		const bundle = buildBundle(subs, {}, {}, EMPTY_PROFILE, { defaultMode: 'single' }, '2026-10-26T00:00:00Z', [B]);
		expect(bundle.competitions).toEqual([B]);

		const result = importSources([{ path: 'b.json', text: JSON.stringify(bundle) }], {
			mode: 'single',
			now: '2026-10-26T00:00:00Z',
			existing: {},
			waveOverrides: {}
		});
		expect(result.competitions).toEqual([B]);
	});

	it('omits the field when there is nothing to carry', () => {
		const bundle = buildBundle(subs, {}, {}, EMPTY_PROFILE, { defaultMode: 'single' }, '2026-10-26T00:00:00Z');
		expect('competitions' in bundle).toBe(false);
	});

	it('loose files report no competitions of their own', () => {
		const result = importSources([synthSource({ chatId: 'z' })], {
			mode: 'single',
			now: '2026-10-26T00:00:00Z',
			existing: {},
			waveOverrides: {}
		});
		expect(result.competitions).toEqual([]);
	});
});

describe('reading stored lists', () => {
	it('drops junk and duplicates', () => {
		expect(readCompetitionList([B, null, { slug: '' }, 'x', B, { slug: 's' }])).toEqual([
			B,
			{ slug: 's', name: 's' }
		]);
		expect(readCompetitionList(undefined)).toEqual([]);
	});

	it('merges with the first occurrence winning', () => {
		expect(mergeCompetitions([B], [{ slug: B.slug, name: 'other' }, A])).toEqual([B, A]);
	});
});
