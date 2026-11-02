import { describe, expect, it } from 'vitest';
import { slugifyCompetition } from '$lib/config';
import { buildBundle, serializeBundle, toBundleEntry } from '$lib/export/bundle';
import { normalizeSubmission } from '$lib/parse/arenaChat';
import { importSources, type ImportOptions } from '$lib/parse/import';
import { EMPTY_PROFILE, isProfileEmpty, readProfile, type Profile } from '$lib/profile';
import { arenaFixture } from '$lib/testing/fixtures';
import { synthSource } from '$lib/testing/make';

const NOW = '2026-10-26T09:30:00.000Z';
const fixture = arenaFixture();
const base: ImportOptions = { mode: 'single', now: NOW, existing: {}, waveOverrides: {} };

const PROFILE: Profile = {
	name: 'chanu',
	rank: '#12',
	uniqueBreaks: '47',
	earnings: '$12,400',
	profileUrl: 'https://app.grayswan.ai/arena/user/6a34359d38ad1e98f8707b0f',
	photo: 'data:image/png;base64,iVBORw0KGgo='
};

describe('slugifyCompetition', () => {
	it('prefixes hand-made slugs so they cannot collide with GSA challenge slugs', () => {
		expect(slugifyCompetition('IPI Black — Wave 3')).toBe('custom-ipi-black-wave-3');
		expect(slugifyCompetition('  Agent Red!!  ')).toBe('custom-agent-red');
	});

	it('still yields a usable key for unusable input', () => {
		expect(slugifyCompetition('')).toBe('custom-unnamed');
		expect(slugifyCompetition('!!!')).toBe('custom-unnamed');
	});
});

describe('renaming a competition', () => {
	it('changes the display name but keeps the slug as the group key', () => {
		const renamed = normalizeSubmission(fixture.json, {
			sourceFile: fixture.path,
			mode: 'single',
			importedAt: NOW,
			competitionNames: { 'ipi-black-2026': 'IPI Black · Wave 2' }
		});
		expect(renamed.competition).toEqual({
			slug: 'ipi-black-2026',
			name: 'IPI Black · Wave 2'
		});
		// Not a user-assigned competition, just a renamed one.
		expect(renamed.competitionAssigned).toBe(false);
		expect(toBundleEntry(renamed).competition).toBeUndefined();
	});

	it('ignores a blank rename', () => {
		const s = normalizeSubmission(fixture.json, {
			sourceFile: fixture.path,
			mode: 'single',
			importedAt: NOW,
			competitionNames: { 'ipi-black-2026': '   ' }
		});
		expect(s.competition.name).toBe('Indirect Prompt Injection: Black');
	});

	it('survives a bundle round trip', () => {
		const imported = importSources([fixture], {
			...base,
			competitionNames: { 'ipi-black-2026': 'Renamed Comp' }
		});
		expect(imported.added[0].competition.name).toBe('Renamed Comp');

		const text = serializeBundle(
			buildBundle(
				imported.added,
				{},
				imported.competitionNames,
				EMPTY_PROFILE,
				{ defaultMode: 'single' },
				NOW
			)
		);
		const back = importSources([{ path: 'b.json', text }], base);
		expect(back.competitionNames).toEqual({ 'ipi-black-2026': 'Renamed Comp' });
		expect(back.added[0].competition.name).toBe('Renamed Comp');
	});

	it('exports only the renames for competitions in the export', () => {
		const imported = importSources([fixture], base);
		const bundle = buildBundle(
			imported.added,
			{},
			{ 'ipi-black-2026': 'Kept', 'other-slug': 'Dropped' },
			EMPTY_PROFILE,
			{ defaultMode: 'single' },
			NOW
		);
		expect(bundle.competitionNames).toEqual({ 'ipi-black-2026': 'Kept' });
	});
});

describe('filing an import under a chosen competition', () => {
	const target = { slug: slugifyCompetition('Wave 3 Sweep'), name: 'Wave 3 Sweep' };

	it('overrides the competition named in the export', () => {
		const result = importSources([fixture, synthSource({ chatId: 's1' })], {
			...base,
			competition: target
		});
		expect(result.added).toHaveLength(2);
		for (const s of result.added) {
			expect(s.competition).toEqual(target);
			expect(s.competitionAssigned).toBe(true);
		}
	});

	it('records the assignment in the bundle entry so it round-trips', () => {
		const result = importSources([fixture], { ...base, competition: target });
		const entry = toBundleEntry(result.added[0]);
		expect(entry.competition).toEqual(target);

		const text = serializeBundle(
			buildBundle(result.added, {}, {}, EMPTY_PROFILE, { defaultMode: 'single' }, NOW)
		);
		// Imported with no target set at all: the assignment must come from the file.
		const back = importSources([{ path: 'b.json', text }], base);
		expect(back.added[0].competition).toEqual(target);
		expect(back.added[0].competitionAssigned).toBe(true);
	});

	it('does not re-file submissions that arrive inside a bundle', () => {
		const original = importSources([fixture], base);
		const text = serializeBundle(
			buildBundle(original.added, {}, {}, EMPTY_PROFILE, { defaultMode: 'single' }, NOW)
		);
		// A target is set, but bundle entries carry their own provenance.
		const back = importSources([{ path: 'b.json', text }], { ...base, competition: target });
		expect(back.added[0].competition.slug).toBe('ipi-black-2026');
		expect(back.added[0].competitionAssigned).toBe(false);
	});

	it('leaves the competition alone when no target is set', () => {
		const result = importSources([fixture], base);
		expect(result.added[0].competition.slug).toBe('ipi-black-2026');
		expect(result.added[0].competitionAssigned).toBe(false);
	});

	it('lets a rename apply on top of an assignment', () => {
		const result = importSources([fixture], {
			...base,
			competition: target,
			competitionNames: { [target.slug]: 'Renamed Sweep' }
		});
		expect(result.added[0].competition).toEqual({ slug: target.slug, name: 'Renamed Sweep' });
	});
});

describe('profile', () => {
	it('treats a blank profile as absent and omits it from the bundle', () => {
		expect(isProfileEmpty(EMPTY_PROFILE)).toBe(true);
		const imported = importSources([fixture], base);
		const bundle = buildBundle(
			imported.added,
			{},
			{},
			EMPTY_PROFILE,
			{ defaultMode: 'single' },
			NOW
		);
		expect(bundle.profile).toBeUndefined();
	});

	it('round-trips every field, photo included', () => {
		const imported = importSources([fixture], base);
		const text = serializeBundle(
			buildBundle(imported.added, {}, {}, PROFILE, { defaultMode: 'single' }, NOW)
		);
		const back = importSources([{ path: 'b.json', text }], base);
		expect(back.profile).toEqual(PROFILE);
	});

	it('reports no profile when the bundle carries none', () => {
		const imported = importSources([fixture], base);
		const text = serializeBundle(
			buildBundle(imported.added, {}, {}, EMPTY_PROFILE, { defaultMode: 'single' }, NOW)
		);
		expect(importSources([{ path: 'b.json', text }], base).profile).toBeNull();
	});

	it('rejects a remote photo src, which would be a network request on export', () => {
		const hostile = readProfile({ ...PROFILE, photo: 'https://example.com/avatar.png' });
		expect(hostile.photo).toBeNull();
		expect(readProfile({ ...PROFILE, photo: 'data:image/png;base64,AAA' }).photo).toBe(
			'data:image/png;base64,AAA'
		);
	});

	it('coerces junk into an empty profile rather than throwing', () => {
		expect(readProfile(null)).toEqual(EMPTY_PROFILE);
		expect(readProfile('nope')).toEqual(EMPTY_PROFILE);
		expect(readProfile({ name: 42 })).toEqual(EMPTY_PROFILE);
	});
});
