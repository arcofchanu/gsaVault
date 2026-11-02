import { mergeCompetitions, readCompetition } from '$lib/competitions';
import { detect, readBundle } from '$lib/parse/detect';
import { normalizeSubmission, ParseError } from '$lib/parse/arenaChat';
import { dateCompare } from '$lib/util/natural';
import { isProfileEmpty, type Profile } from '$lib/profile';
import type {
	Competition,
	ImportFailure,
	ImportResult,
	Mode,
	SourceFile,
	Submission,
	VaultSettings
} from '$lib/types';

export interface ImportOptions {
	/** Mode stamped on loose submissions (the header toggle at drop time). */
	mode: Mode;
	/** Clock injected so tests and bundle round-trips are deterministic. */
	now: string;
	/** Already-stored submissions, for dedupe. */
	existing: Readonly<Record<string, Submission>>;
	/** Current vault overrides; bundle overrides are merged on top. */
	waveOverrides: Readonly<Record<string, string>>;
	/** Current renames; bundle renames are merged on top. */
	competitionNames?: Readonly<Record<string, string>>;
	/**
	 * File loose submissions under this competition instead of the one named in
	 * the export. Submissions arriving inside a vault bundle keep their own.
	 */
	competition?: Competition | null;
}

/** One normalization candidate, before dedupe. */
interface Candidate {
	path: string;
	raw: unknown;
	mode: Mode;
	importedAt: string;
	sourceFile: string;
	competition?: Competition;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch (err) {
		return { ok: false, reason: `malformed JSON: ${(err as Error).message}` };
	}
}

/**
 * Turn flattened JSON documents into submissions, applying the dedupe rules
 * from PRD §4.1. Pure: it reports what should change without touching storage.
 *
 * Bundles are read first so their wave overrides are in force before any
 * submission is normalized — otherwise a round-tripped vault would come back
 * with derived waves instead of the user's overrides.
 */
export function importSources(sources: readonly SourceFile[], opts: ImportOptions): ImportResult {
	const failed: ImportFailure[] = [];
	const candidates: Candidate[] = [];
	const waveOverrides: Record<string, string> = { ...opts.waveOverrides };
	const competitionNames: Record<string, string> = { ...opts.competitionNames };
	const target = opts.competition ?? undefined;
	let settings: VaultSettings | null = null;
	let profile: Profile | null = null;
	let competitions: Competition[] = [];
	let bundleCount = 0;

	for (const source of sources) {
		const parsed = parseJson(source.text);
		if (!parsed.ok) {
			failed.push({ path: source.path, reason: parsed.reason });
			continue;
		}

		switch (detect(parsed.value)) {
			case 'arena-submission':
				candidates.push({
					path: source.path,
					raw: parsed.value,
					mode: opts.mode,
					importedAt: opts.now,
					sourceFile: source.path,
					competition: target
				});
				break;

			case 'vault-bundle': {
				const bundle = readBundle(parsed.value);
				bundleCount++;
				settings = bundle.settings;
				Object.assign(waveOverrides, bundle.waveOverrides);
				Object.assign(competitionNames, bundle.competitionNames ?? {});
				competitions = mergeCompetitions(competitions, bundle.competitions ?? []);
				if (bundle.profile !== undefined && !isProfileEmpty(bundle.profile)) profile = bundle.profile;
				if (bundle.submissions.length === 0) {
					failed.push({ path: source.path, reason: 'vault bundle contains no submissions' });
					break;
				}
				bundle.submissions.forEach((entry, i) => {
					if (entry === null || typeof entry !== 'object' || entry.raw === undefined) {
						failed.push({ path: `${source.path}#${i}`, reason: 'bundle entry has no raw export' });
						return;
					}
					candidates.push({
						path: `${source.path}#${i}`,
						raw: entry.raw,
						// Modes and competition assignments travel with the bundle; the
						// header controls must not override them.
						mode: entry.mode === 'multi' ? 'multi' : 'single',
						importedAt: typeof entry.importedAt === 'string' ? entry.importedAt : opts.now,
						sourceFile:
							typeof entry.sourceFile === 'string' && entry.sourceFile !== ''
								? entry.sourceFile
								: `${source.path}#${i}`,
						competition: readCompetition(entry.competition)
					});
				});
				break;
			}

			default:
				failed.push({ path: source.path, reason: 'not a GSA arena export or vault bundle' });
		}
	}

	const added: Submission[] = [];
	const replaced: Submission[] = [];
	const duplicates: { path: string; id: string }[] = [];
	// Working view of the vault so duplicates inside one drop are caught too.
	const seen = new Map<string, Submission>(Object.entries(opts.existing));

	for (const candidate of candidates) {
		let submission: Submission;
		try {
			submission = normalizeSubmission(candidate.raw, {
				sourceFile: candidate.sourceFile,
				mode: candidate.mode,
				importedAt: candidate.importedAt,
				waveOverrides,
				competition: candidate.competition,
				competitionNames
			});
		} catch (err) {
			const reason = err instanceof ParseError ? err.message : (err as Error).message;
			failed.push({ path: candidate.path, reason: `could not parse export: ${reason}` });
			continue;
		}

		const prior = seen.get(submission.id);
		if (prior === undefined) {
			seen.set(submission.id, submission);
			added.push(submission);
			continue;
		}

		// Same chatId twice: keep whichever was exported later (PRD §4.1).
		if (dateCompare(prior.exportedAt, submission.exportedAt) < 0) {
			seen.set(submission.id, submission);
			replaced.push(submission);
		} else {
			duplicates.push({ path: candidate.path, id: submission.id });
		}
	}

	// A record can be added then superseded within one drop; report it once.
	const addedIds = new Set(added.map((s) => s.id));
	const finalReplaced = replaced.filter((s) => !addedIds.has(s.id));
	const finalAdded = added.map((s) => seen.get(s.id) ?? s);

	return {
		added: finalAdded,
		replaced: finalReplaced,
		duplicates,
		failed,
		waveOverrides,
		competitionNames,
		competitions,
		profile,
		settings,
		bundleCount
	};
}

/** `+12 added · 3 duplicates skipped · 1 failed` */
export function summarize(result: ImportResult): string {
	const parts = [`+${result.added.length} added`];
	if (result.replaced.length > 0) parts.push(`${result.replaced.length} refreshed`);
	if (result.duplicates.length > 0) parts.push(`${result.duplicates.length} duplicates skipped`);
	if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
	return parts.join(' · ');
}
