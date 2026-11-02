import { clear, createStore, del, entries, get, set, setMany } from 'idb-keyval';
import { readCompetitionList } from '$lib/competitions';
import { readProfile, type Profile } from '$lib/profile';
import type { BundleEntry, Competition, VaultSettings } from '$lib/types';

/**
 * Two tiny IndexedDB databases: one keyed by submission id (PRD §3), one for
 * the handful of user-set values. `idb-keyval`'s `createStore` owns a single
 * object store per database, hence the split.
 *
 * Records are stored as `BundleEntry` — verbatim export plus user-set fields —
 * exactly like the JSON bundle, so a reload and a bundle re-import re-derive
 * through the same path.
 */
const submissionStore = createStore('gsa-vault', 'submissions');
const metaStore = createStore('gsa-vault-meta', 'meta');

const KEY_OVERRIDES = 'waveOverrides';
const KEY_NAMES = 'competitionNames';
const KEY_SETTINGS = 'settings';
const KEY_PROFILE = 'profile';
const KEY_COMPETITIONS = 'competitions';

export interface PersistedVault {
	entries: Record<string, BundleEntry>;
	waveOverrides: Record<string, string>;
	competitionNames: Record<string, string>;
	profile: Profile;
	/** Competitions kept listed even when empty. */
	competitions: Competition[];
	settings: VaultSettings | null;
}

export async function loadVault(): Promise<PersistedVault> {
	const [rows, overrides, names, profile, settings, competitions] = await Promise.all([
		entries<string, BundleEntry>(submissionStore),
		get<Record<string, string>>(KEY_OVERRIDES, metaStore),
		get<Record<string, string>>(KEY_NAMES, metaStore),
		get<unknown>(KEY_PROFILE, metaStore),
		get<VaultSettings>(KEY_SETTINGS, metaStore),
		get<unknown>(KEY_COMPETITIONS, metaStore)
	]);
	return {
		entries: Object.fromEntries(rows),
		waveOverrides: overrides ?? {},
		competitionNames: names ?? {},
		profile: readProfile(profile),
		competitions: readCompetitionList(competitions),
		settings: settings ?? null
	};
}

export function saveEntries(records: readonly [string, BundleEntry][]): Promise<void> {
	return setMany([...records], submissionStore);
}

export function saveEntry(id: string, entry: BundleEntry): Promise<void> {
	return set(id, entry, submissionStore);
}

export function deleteEntry(id: string): Promise<void> {
	return del(id, submissionStore);
}

export function saveOverrides(overrides: Record<string, string>): Promise<void> {
	return set(KEY_OVERRIDES, overrides, metaStore);
}

export function saveCompetitionNames(names: Record<string, string>): Promise<void> {
	return set(KEY_NAMES, names, metaStore);
}

export function saveProfile(profile: Profile): Promise<void> {
	return set(KEY_PROFILE, profile, metaStore);
}

export function saveCompetitions(competitions: Competition[]): Promise<void> {
	return set(KEY_COMPETITIONS, competitions, metaStore);
}

export function saveSettings(settings: VaultSettings): Promise<void> {
	return set(KEY_SETTINGS, settings, metaStore);
}

export async function clearVault(): Promise<void> {
	await Promise.all([clear(submissionStore), clear(metaStore)]);
}
