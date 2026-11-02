import { ARENA_KINDS, BUNDLE_SCHEMA, submissionKey } from '$lib/config';
import { readCompetitionList } from '$lib/competitions';
import { readProfile } from '$lib/profile';
import type { VaultBundle, VaultSettings } from '$lib/types';

export type DetectedKind = 'arena-submission' | 'vault-bundle' | 'unknown';

const ARENA_KIND_SET: ReadonlySet<string> = new Set<string>(ARENA_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Classify one parsed JSON document (PRD §4.1). A GSA export is recognised by
 * `kind`, or leniently by shape — a dedupe key plus a `messages` array — so a
 * slightly-off export is archived rather than dropped.
 */
export function detect(value: unknown): DetectedKind {
	if (!isRecord(value)) return 'unknown';

	const schema = value.schema;
	if (typeof schema === 'string' && (schema === BUNDLE_SCHEMA || schema.startsWith('gsa-vault/'))) {
		return 'vault-bundle';
	}

	const kind = value.kind;
	if (typeof kind === 'string' && ARENA_KIND_SET.has(kind)) return 'arena-submission';

	const hasKey = submissionKey(value as { chatId?: unknown; submissionId?: unknown }) !== null;
	if (hasKey && Array.isArray(value.messages)) return 'arena-submission';

	return 'unknown';
}

const DEFAULT_SETTINGS: VaultSettings = { defaultMode: 'single' };

function normalizeSettings(value: unknown): VaultSettings {
	if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
	return { defaultMode: value.defaultMode === 'multi' ? 'multi' : 'single' };
}

function normalizeOverrides(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, wave] of Object.entries(value)) {
		if (typeof wave === 'string' && wave.trim() !== '') out[key] = wave;
	}
	return out;
}

/**
 * Coerce a detected bundle into the shape the importer expects. Unknown future
 * keys are ignored; malformed entries are skipped by the importer, not here.
 */
export function readBundle(value: unknown): VaultBundle {
	const rec = isRecord(value) ? value : {};
	return {
		schema: typeof rec.schema === 'string' ? rec.schema : BUNDLE_SCHEMA,
		exportedAt: typeof rec.exportedAt === 'string' ? rec.exportedAt : '',
		settings: normalizeSettings(rec.settings),
		waveOverrides: normalizeOverrides(rec.waveOverrides),
		competitionNames: normalizeOverrides(rec.competitionNames),
		profile: readProfile(rec.profile),
		competitions: readCompetitionList(rec.competitions),
		submissions: Array.isArray(rec.submissions) ? (rec.submissions as VaultBundle['submissions']) : []
	};
}

export { DEFAULT_SETTINGS };
