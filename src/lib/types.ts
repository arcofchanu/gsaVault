import type { Profile } from '$lib/profile';

export type Mode = 'single' | 'multi';

export interface ToolCall {
	name: string;
	arguments: unknown;
	output: unknown;
	outputError?: unknown;
}

export interface Message {
	role: string;
	content: string;
	timestamp: string;
	toolCalls: ToolCall[];
}

export interface ProseField {
	/** Dotted path to the field, e.g. `body` or `items.0.note`. */
	field: string;
	text: string;
}

export interface PayloadSlot {
	/** 1-based position in `title`; preserved for empty slots too. */
	index: number;
	/** Exact slot text, untouched. */
	raw: string;
	/** `[]` or blank — an unused injection surface. */
	empty: boolean;
	/** `JSON.parse` result, or null when the slot is not JSON. */
	parsed: unknown | null;
	/** Long string fields lifted out of `parsed` (note/body/subject/...). */
	prose: ProseField[];
}

export interface Competition {
	slug: string;
	name: string;
}

export interface Submission {
	/** Dedupe key — see `submissionKey` in config.ts. */
	id: string;
	competition: Competition;
	/** True when the competition came from the user, not from `challenge`. */
	competitionAssigned: boolean;
	/** Derived from the scenario code, or a user override. NO_WAVE if neither. */
	wave: string;
	scenario: { full: string; code: string; label: string };
	model: string;
	mode: Mode;
	/** Auto-detected suggestion; never applied without the user's click. */
	modeHint: Mode | null;
	createdAt: string;
	exportedAt: string;
	/** First `role: "user"` message. */
	initialTask: string;
	payloadSlots: PayloadSlot[];
	/** Where payloadSlots came from: the `title` slots, or the initial task. */
	payloadSource: 'title' | 'initialTask';
	transcript: Message[];
	/** e.g. `batch1.zip/chat-ipi-black-2026-xyz.json` */
	sourceFile: string;
	importedAt: string;
	/** The original export, verbatim. Never read by the UI; makes export lossless. */
	raw: unknown;
}

export interface VaultSettings {
	defaultMode: Mode;
}

export interface VaultState {
	/** Researcher profile shown on the PDF cover. */
	profile: Profile;
	submissions: Record<string, Submission>;
	/** key: `${competitionSlug}::${scenarioCode}` */
	waveOverrides: Record<string, string>;
	/** Display-name override per competition slug. The slug stays the group key. */
	competitionNames: Record<string, string>;
	settings: VaultSettings;
}

/* ---- import ---- */

export interface SourceFile {
	/** Display path, including any zip prefix. */
	path: string;
	text: string;
}

export interface ImportFailure {
	path: string;
	reason: string;
}

export interface ImportResult {
	/** Brand-new ids. */
	added: Submission[];
	/** Existing ids whose stored record was refreshed (newer `exportedAt`). */
	replaced: Submission[];
	/** Same id, already present and not newer — skipped. */
	duplicates: { path: string; id: string }[];
	failed: ImportFailure[];
	/** Wave overrides merged out of any imported vault bundles. */
	waveOverrides: Record<string, string>;
	/** Competition renames merged out of any imported vault bundles. */
	competitionNames: Record<string, string>;
	/** Listed competitions carried by imported bundles (empty ones included). */
	competitions: Competition[];
	/** Profile from the last imported bundle that carried one, else null. */
	profile: Profile | null;
	/** Settings from the last imported bundle, or null if none. */
	settings: VaultSettings | null;
	bundleCount: number;
}

/* ---- bundle (PRD §6.2) ---- */

export interface BundleEntry {
	mode: Mode;
	sourceFile: string;
	importedAt: string;
	/**
	 * Competition the user filed this submission under, overriding `challenge`
	 * in the export. Absent means "take it from the file".
	 */
	competition?: Competition;
	/** Original GSA export, verbatim. */
	raw: unknown;
}

export interface VaultBundle {
	schema: string;
	exportedAt: string;
	settings: VaultSettings;
	waveOverrides: Record<string, string>;
	/** Optional — bundles written before renaming existed simply omit it. */
	competitionNames?: Record<string, string>;
	/** Optional — the researcher profile, if one has been filled in. */
	profile?: Profile;
	/**
	 * Optional — competitions to keep listed even with nothing in them (made by
	 * hand, or emptied by moving their waves away).
	 */
	competitions?: Competition[];
	submissions: BundleEntry[];
}
