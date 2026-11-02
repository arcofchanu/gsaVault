import { BUNDLE_SCHEMA } from '$lib/config';
import { waveOverrideKey } from '$lib/parse/arenaChat';
import { isProfileEmpty, type Profile } from '$lib/profile';
import type { BundleEntry, Competition, Submission, VaultBundle, VaultSettings } from '$lib/types';

/**
 * The only parts of a submission worth persisting: the verbatim export plus the
 * fields the user set. Everything else is re-derived, so a bundle (and the
 * IndexedDB store, which uses the same shape) reproduces the vault exactly and
 * stays valid if the parser improves (PRD §6.2).
 */
export function toBundleEntry(submission: Submission): BundleEntry {
	const entry: BundleEntry = {
		mode: submission.mode,
		sourceFile: submission.sourceFile,
		importedAt: submission.importedAt,
		raw: submission.raw
	};
	// Only recorded when the user filed it somewhere other than the export said;
	// otherwise the competition is re-derived from `raw` like everything else.
	if (submission.competitionAssigned) {
		entry.competition = { slug: submission.competition.slug, name: submission.competition.name };
	}
	return entry;
}

/** Keep only the overrides that apply to the submissions being exported. */
function relevantOverrides(
	submissions: readonly Submission[],
	waveOverrides: Readonly<Record<string, string>>
): Record<string, string> {
	const keys = new Set(
		submissions.map((s) => waveOverrideKey(s.competition.slug, s.scenario.code))
	);
	const out: Record<string, string> = {};
	for (const [key, wave] of Object.entries(waveOverrides)) {
		if (keys.has(key)) out[key] = wave;
	}
	return out;
}

/** Keep only the renames for competitions present in the export. */
function relevantNames(
	submissions: readonly Submission[],
	competitionNames: Readonly<Record<string, string>>
): Record<string, string> {
	const slugs = new Set(submissions.map((s) => s.competition.slug));
	const out: Record<string, string> = {};
	for (const [slug, name] of Object.entries(competitionNames)) {
		if (slugs.has(slug)) out[slug] = name;
	}
	return out;
}

export function buildBundle(
	submissions: readonly Submission[],
	waveOverrides: Readonly<Record<string, string>>,
	competitionNames: Readonly<Record<string, string>>,
	profile: Profile,
	settings: VaultSettings,
	exportedAt: string,
	/** Listed competitions to carry, e.g. empty ones on a whole-vault export. */
	competitions: readonly Competition[] = []
): VaultBundle {
	return {
		schema: BUNDLE_SCHEMA,
		exportedAt,
		settings: { ...settings },
		waveOverrides: relevantOverrides(submissions, waveOverrides),
		competitionNames: relevantNames(submissions, competitionNames),
		// Only carried when filled in, so an untouched vault round-trips unchanged.
		...(isProfileEmpty(profile) ? {} : { profile: { ...profile } }),
		...(competitions.length === 0
			? {}
			: { competitions: competitions.map((c) => ({ slug: c.slug, name: c.name })) }),
		submissions: submissions.map(toBundleEntry)
	};
}

export function serializeBundle(bundle: VaultBundle): string {
	return JSON.stringify(bundle, null, 2);
}

/** `gsa-vault-2026-10-26.json` */
export function bundleFilename(exportedAt: string): string {
	const t = Date.parse(exportedAt);
	const day = Number.isNaN(t) ? 'unknown' : new Date(t).toISOString().slice(0, 10);
	return `gsa-vault-${day}.json`;
}
