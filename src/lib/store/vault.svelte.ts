import { DEFAULT_SETTINGS } from '$lib/parse/detect';
import { normalizeSubmission, waveOverrideKey } from '$lib/parse/arenaChat';
import { importSources } from '$lib/parse/import';
import { expandFiles } from '$lib/parse/zip';
import { toBundleEntry } from '$lib/export/bundle';
import { buildTree, computeStats, type VaultTree } from '$lib/stats';
import {
	listCompetitions,
	mergeCompetitions,
	planWaveMove,
	resolveNewCompetition
} from '$lib/competitions';
import { naturalCompare } from '$lib/util/natural';
import { EMPTY_PROFILE, type Profile } from '$lib/profile';
import {
	clearVault,
	deleteEntry,
	loadVault,
	saveEntries,
	saveEntry,
	saveCompetitionNames,
	saveCompetitions,
	saveOverrides,
	saveProfile,
	saveSettings
} from '$lib/store/persist';
import type {
	BundleEntry,
	Competition,
	ImportResult,
	Mode,
	Submission,
	VaultSettings
} from '$lib/types';

/**
 * Re-derive every submission from its stored raw export. Cheap (title split +
 * message mapping) and it means an override change, a reload and a bundle
 * re-import all flow through one code path.
 */
function deriveAll(
	entries: Readonly<Record<string, BundleEntry>>,
	waveOverrides: Readonly<Record<string, string>>,
	competitionNames: Readonly<Record<string, string>>
): Record<string, Submission> {
	const out: Record<string, Submission> = {};
	for (const [id, entry] of Object.entries(entries)) {
		try {
			const submission = normalizeSubmission(entry.raw, {
				sourceFile: entry.sourceFile,
				mode: entry.mode,
				importedAt: entry.importedAt,
				waveOverrides,
				competition: entry.competition,
				competitionNames
			});
			out[submission.id] = submission;
		} catch {
			// A stored record we can no longer parse: drop it from the view rather
			// than taking the whole vault down. It stays on disk for a future fix.
			void id;
		}
	}
	return out;
}

/**
 * Strip Svelte's reactive proxies before anything crosses a structured-clone
 * boundary.
 *
 * `IDBObjectStore.put` clones its value, and the algorithm throws
 * `DataCloneError` on a Proxy — so persisting anything read back out of
 * `$state` fails. It fails *quietly*, too: the write rejects, the in-memory
 * value is already correct, and the loss only shows up after a reload.
 */
function snapshot<T>(value: T): T {
	return $state.snapshot(value) as T;
}

class Vault {
	/** Source of truth: verbatim exports plus user-set fields, keyed by id. */
	private entries = $state<Record<string, BundleEntry>>({});
	waveOverrides = $state<Record<string, string>>({});
	/** slug -> display name, so a competition can be renamed without re-import. */
	competitionNames = $state<Record<string, string>>({});
	/** Researcher details printed on the PDF cover. */
	profile = $state<Profile>({ ...EMPTY_PROFILE });
	settings = $state<VaultSettings>({ ...DEFAULT_SETTINGS });
	/**
	 * Competitions kept listed even with nothing in them: ones the user made,
	 * and ones whose waves were all moved elsewhere. See `competitions.ts`.
	 */
	registry = $state<Competition[]>([]);

	/** False until IndexedDB has been read, so the UI can avoid a flash of empty. */
	ready = $state(false);
	/** Set when persistence is unavailable (private mode, disabled storage). */
	storageError = $state<string | null>(null);

	submissions = $derived(deriveAll(this.entries, this.waveOverrides, this.competitionNames));
	list = $derived(Object.values(this.submissions));
	tree = $derived(buildTree(this.list));
	stats = $derived(computeStats(this.list));
	count = $derived(this.list.length);

	private started = false;

	/**
	 * Read the vault out of IndexedDB.
	 *
	 * Storage can be slow, blocked (another tab mid-upgrade) or simply never
	 * answer in a locked-down browser, so the UI is released after a grace
	 * period either way: an archive you can drop files into beats a permanent
	 * loading screen. A late-arriving read still populates the vault and clears
	 * the warning.
	 */
	async init(): Promise<void> {
		if (this.started) return;
		this.started = true;

		const load = (async () => {
			try {
				const loaded = await loadVault();
				this.entries = loaded.entries;
				this.waveOverrides = loaded.waveOverrides;
				this.competitionNames = loaded.competitionNames;
				this.profile = loaded.profile;
				this.registry = loaded.competitions;
				if (loaded.settings !== null) this.settings = loaded.settings;
				this.storageError = null;
			} catch (err) {
				this.storageError = `vault storage unavailable: ${(err as Error).message}`;
			} finally {
				this.ready = true;
			}
		})();

		const grace = setTimeout(() => {
			if (this.ready) return;
			this.ready = true;
			this.storageError = 'this browser’s storage did not respond';
		}, 2500);

		await load;
		clearTimeout(grace);
	}

	/**
	 * Drop of loose `.json` and `.zip` files. `competition` files them under a
	 * competition of the user's choosing rather than the one in the export.
	 */
	async importFiles(
		files: readonly File[],
		mode: Mode,
		competition?: Competition | null
	): Promise<ImportResult> {
		const expanded = await expandFiles(files);
		const result = await this.applyImport(expanded.sources, mode, competition);
		return { ...result, failed: [...expanded.failed, ...result.failed] };
	}

	/** "Paste JSON" modal — a single document typed or pasted by hand. */
	async importText(
		text: string,
		path: string,
		mode: Mode,
		competition?: Competition | null
	): Promise<ImportResult> {
		return this.applyImport([{ path, text }], mode, competition);
	}

	private async applyImport(
		sources: readonly { path: string; text: string }[],
		mode: Mode,
		competition?: Competition | null
	): Promise<ImportResult> {
		const result = importSources(sources, {
			mode,
			now: new Date().toISOString(),
			existing: this.submissions,
			waveOverrides: this.waveOverrides,
			competitionNames: this.competitionNames,
			competition
		});

		const changed = [...result.added, ...result.replaced];
		if (changed.length === 0 && result.bundleCount === 0) return result;

		const records = changed.map((s) => [s.id, toBundleEntry(s)] as [string, BundleEntry]);
		this.entries = { ...this.entries, ...Object.fromEntries(records) };
		this.waveOverrides = result.waveOverrides;
		this.competitionNames = result.competitionNames;
		this.registry = mergeCompetitions(this.registry, [
			...result.competitions,
			...(competition ? [competition] : [])
		]);
		if (result.profile !== null) this.profile = result.profile;
		if (result.settings !== null) this.settings = result.settings;

		await this.persist(() =>
			Promise.all([
				records.length > 0 ? saveEntries(snapshot(records)) : Promise.resolve(),
				saveOverrides(snapshot(this.waveOverrides)),
				saveCompetitionNames(snapshot(this.competitionNames)),
				saveProfile(snapshot(this.profile)),
				saveSettings(snapshot(this.settings)),
				saveCompetitions(snapshot(this.registry))
			])
		);
		return result;
	}

	/**
	 * Rename a competition. Keyed by slug, so every submission in the group
	 * follows, and the rename travels in the JSON bundle. Passing null (or the
	 * name the exports already carry) clears the override.
	 */
	async setCompetitionName(slug: string, name: string | null): Promise<void> {
		const next = { ...this.competitionNames };
		if (name === null || name.trim() === '') delete next[slug];
		else next[slug] = name.trim();
		this.competitionNames = next;
		await this.persist(() => saveCompetitionNames(snapshot(next)));
	}

	/** Replace the researcher profile shown on the PDF cover. */
	async setProfile(profile: Profile): Promise<void> {
		this.profile = { ...profile };
		await this.persist(() => saveProfile(snapshot(this.profile)));
	}

	/** Every competition, empty ones included — the picker and export dialog. */
	competitions = $derived(listCompetitions(this.list, this.registry, this.competitionNames));

	/** The sidebar tree: the real tree plus a bare node per empty competition. */
	sidebarTree = $derived.by((): VaultTree => {
		const present = new Set(this.tree.map((c) => c.slug));
		const empty = this.competitions
			.filter((c) => !present.has(c.slug))
			.map((c) => ({ slug: c.slug, name: c.name, count: 0, waves: [] }));
		return [...this.tree, ...empty].sort((a, b) => naturalCompare(a.name, b.name));
	});

	/**
	 * Create a competition from a typed name and keep it listed, so it exists
	 * before anything is filed under it. Reuses one with the same name.
	 */
	async createCompetition(name: string): Promise<Competition | null> {
		const resolved = resolveNewCompetition(name, this.competitions);
		if (resolved === null) return null;
		if (resolved.created) {
			this.registry = mergeCompetitions(this.registry, [resolved.competition]);
			await this.persist(() => saveCompetitions(snapshot(this.registry)));
		}
		return resolved.competition;
	}

	/** Forget an empty competition. One that still holds submissions stays. */
	async deleteCompetition(slug: string): Promise<boolean> {
		if (this.list.some((s) => s.competition.slug === slug)) return false;
		this.registry = this.registry.filter((c) => c.slug !== slug);
		const names = { ...this.competitionNames };
		delete names[slug];
		this.competitionNames = names;
		await this.persist(() =>
			Promise.all([
				saveCompetitions(snapshot(this.registry)),
				saveCompetitionNames(snapshot(names))
			])
		);
		return true;
	}

	/**
	 * File a whole wave under another competition. Both ends stay listed, so
	 * emptying a competition does not make it vanish from the sidebar.
	 */
	async moveWave(fromSlug: string, wave: string, toSlug: string): Promise<number> {
		const from = this.competitions.find((c) => c.slug === fromSlug);
		const to = this.competitions.find((c) => c.slug === toSlug);
		if (from === undefined || to === undefined || fromSlug === toSlug) return 0;

		// Store the competition's own name, not a rename layered on top of it.
		const base = this.registry.find((c) => c.slug === toSlug) ?? to;
		const plan = planWaveMove(this.list, this.waveOverrides, fromSlug, wave, base);
		const ids = Object.keys(plan.assign);
		if (ids.length === 0) return 0;

		const records = ids.flatMap((id) => {
			const entry = this.entries[id];
			return entry === undefined
				? []
				: [[id, { ...entry, competition: plan.assign[id]! }] as [string, BundleEntry]];
		});
		this.entries = { ...this.entries, ...Object.fromEntries(records) };
		this.waveOverrides = plan.waveOverrides;
		this.registry = mergeCompetitions(this.registry, [from, to]);

		await this.persist(() =>
			Promise.all([
				saveEntries(snapshot(records)),
				saveOverrides(snapshot(this.waveOverrides)),
				saveCompetitions(snapshot(this.registry))
			])
		);
		return records.length;
	}

	/** Flip one submission between single-turn and multi-turn. */
	async setMode(id: string, mode: Mode): Promise<void> {
		const entry = this.entries[id];
		if (entry === undefined || entry.mode === mode) return;
		const next: BundleEntry = { ...entry, mode };
		this.entries = { ...this.entries, [id]: next };
		await this.persist(() => saveEntry(id, snapshot(next)));
	}

	/** Mode stamped on the next drop. */
	async setDefaultMode(mode: Mode): Promise<void> {
		if (this.settings.defaultMode === mode) return;
		this.settings = { ...this.settings, defaultMode: mode };
		await this.persist(() => saveSettings(snapshot(this.settings)));
	}

	/**
	 * Set or clear the wave for a scenario code within a competition. Passing
	 * null restores the wave derived from the code.
	 */
	async setWave(competitionSlug: string, scenarioCode: string, wave: string | null): Promise<void> {
		const key = waveOverrideKey(competitionSlug, scenarioCode);
		const next = { ...this.waveOverrides };
		if (wave === null || wave.trim() === '') delete next[key];
		else next[key] = wave.trim();
		this.waveOverrides = next;
		await this.persist(() => saveOverrides(snapshot(next)));
	}

	async remove(id: string): Promise<void> {
		if (this.entries[id] === undefined) return;
		const next = { ...this.entries };
		delete next[id];
		this.entries = next;
		await this.persist(() => deleteEntry(id));
	}

	async clearAll(): Promise<void> {
		this.entries = {};
		this.waveOverrides = {};
		this.competitionNames = {};
		this.registry = [];
		this.profile = { ...EMPTY_PROFILE };
		this.settings = { ...DEFAULT_SETTINGS };
		await this.persist(() => clearVault());
	}

	/** Keep the in-memory vault usable even when IndexedDB refuses to write. */
	private async persist(write: () => Promise<unknown>): Promise<void> {
		try {
			await write();
			this.storageError = null;
		} catch (err) {
			this.storageError = `could not save to this browser's storage: ${(err as Error).message}`;
		}
	}
}

export const vault = new Vault();
