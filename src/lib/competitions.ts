import { slugifyCompetition } from '$lib/config';
import { waveOverrideKey } from '$lib/parse/arenaChat';
import { naturalCompare } from '$lib/util/natural';
import type { Competition, Submission } from '$lib/types';

/**
 * Competitions as a list the user owns, not just a by-product of submissions.
 *
 * A competition normally exists because some submission names it. The
 * registry adds the ones that must stay listed with nothing in them: one the
 * user just created, and one whose last wave was moved elsewhere. Pure, so the
 * store stays thin and all of this is unit-tested.
 */

/** A competition as stored in a bundle entry or the registry, if usable. */
export function readCompetition(value: unknown): Competition | undefined {
	if (value === null || typeof value !== 'object') return undefined;
	const rec = value as { slug?: unknown; name?: unknown };
	if (typeof rec.slug !== 'string' || rec.slug === '') return undefined;
	return {
		slug: rec.slug,
		name: typeof rec.name === 'string' && rec.name !== '' ? rec.name : rec.slug
	};
}

export function readCompetitionList(value: unknown): Competition[] {
	if (!Array.isArray(value)) return [];
	return mergeCompetitions([], value.map(readCompetition).filter((c) => c !== undefined));
}

/** Union by slug; the first occurrence wins. */
export function mergeCompetitions(
	base: readonly Competition[],
	extra: readonly Competition[]
): Competition[] {
	const out = new Map<string, Competition>();
	for (const c of [...base, ...extra]) {
		if (!out.has(c.slug)) out.set(c.slug, { slug: c.slug, name: c.name });
	}
	return [...out.values()];
}

/**
 * Every competition the vault knows: those with submissions, plus the
 * registry, with renames applied. Sorted the way the sidebar shows them.
 */
export function listCompetitions(
	submissions: readonly Submission[],
	registry: readonly Competition[],
	competitionNames: Readonly<Record<string, string>>
): Competition[] {
	const fromSubmissions = submissions.map((s) => s.competition);
	const renamed = registry.map((c) => ({
		slug: c.slug,
		name: competitionNames[c.slug]?.trim() || c.name
	}));
	return mergeCompetitions(fromSubmissions, renamed).sort((a, b) => naturalCompare(a.name, b.name));
}

/**
 * Turn a typed name into a competition. Reuses an existing one with the same
 * name (case-insensitive) rather than making a near-duplicate, and never hands
 * out a slug that is already taken.
 */
export function resolveNewCompetition(
	name: string,
	existing: readonly Competition[]
): { competition: Competition; created: boolean } | null {
	const trimmed = name.trim();
	if (trimmed === '') return null;

	const same = existing.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
	if (same !== undefined) return { competition: { ...same }, created: false };

	const taken = new Set(existing.map((c) => c.slug));
	const base = slugifyCompetition(trimmed);
	let slug = base;
	for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
	return { competition: { slug, name: trimmed }, created: true };
}

export interface WaveMove {
	/** Submission id -> the competition it is now filed under. */
	assign: Record<string, Competition>;
	/** The full wave-override map after the move. */
	waveOverrides: Record<string, string>;
}

/**
 * Move every submission of one wave to another competition.
 *
 * Wave overrides are keyed by (competition, scenario code), so a wave that was
 * set by hand would quietly revert to the derived one on arrival. Copy each
 * moved scenario's override across, and drop the old one once no submission
 * in the source still uses that scenario.
 */
export function planWaveMove(
	submissions: readonly Submission[],
	waveOverrides: Readonly<Record<string, string>>,
	fromSlug: string,
	wave: string,
	to: Competition
): WaveMove {
	const overrides = { ...waveOverrides };
	const assign: Record<string, Competition> = {};
	if (fromSlug === to.slug) return { assign, waveOverrides: overrides };

	const moving = submissions.filter((s) => s.competition.slug === fromSlug && s.wave === wave);
	for (const s of moving) assign[s.id] = { slug: to.slug, name: to.name };

	const codes = new Set(moving.map((s) => s.scenario.code));
	for (const code of codes) {
		const fromKey = waveOverrideKey(fromSlug, code);
		const value = overrides[fromKey];
		if (value === undefined) continue;
		overrides[waveOverrideKey(to.slug, code)] = value;
		const stillUsed = submissions.some(
			(s) => s.competition.slug === fromSlug && s.scenario.code === code && assign[s.id] === undefined
		);
		if (!stillUsed) delete overrides[fromKey];
	}

	return { assign, waveOverrides: overrides };
}
