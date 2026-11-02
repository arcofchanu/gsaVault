import { emptyFilter, type Filter } from '$lib/stats';
import type { ImportFailure } from '$lib/types';

export interface Toast {
	id: number;
	text: string;
	kind: 'info' | 'warn';
	/** Expandable detail — failed file names and reasons. */
	failures: ImportFailure[];
	expanded: boolean;
}

let nextToastId = 1;

/**
 * View state: the active filter, transient overlays and toasts. Deliberately
 * not persisted — a reload should show the whole vault.
 */
class Ui {
	/**
	 * `filter.competition` doubles as the active competition: the one the
	 * header's "into" picker shows, the one the next drop or paste is filed
	 * under, and the one the home page is scoped to. Null means every
	 * competition, with each file filed by the `challenge` it names.
	 */
	filter = $state<Filter>(emptyFilter());

	/**
	 * Opens the hidden file input. The input lives in the layout, so anything
	 * that wants to offer a "pick files" affordance goes through here rather
	 * than owning a second input and duplicating the import path.
	 */
	private picker: (() => void) | null = null;
	/** Sidebar is a drawer below 900px. */
	drawerOpen = $state(false);
	pasteOpen = $state(false);
	profileOpen = $state(false);
	/** Non-null while a drag is over the window. */
	dragging = $state(false);
	busy = $state<string | null>(null);
	/** Which export the "what to export" dialog is open for, if any. */
	exportOpen = $state<'pdf' | 'json' | null>(null);
	toasts = $state<Toast[]>([]);
	/** Index of the keyboard-focused card in the current list. */
	cursor = $state(0);

	registerFilePicker(open: () => void): void {
		this.picker = open;
	}

	pickFiles(): void {
		this.picker?.();
	}

	setFilter(patch: Partial<Filter>): void {
		this.filter = { ...this.filter, ...patch };
		this.cursor = 0;
	}

	/**
	 * Clear the narrowing filters but keep the active competition — that is a
	 * choice of where you are working, not a search to dismiss. Use
	 * `setActiveCompetition(null)` to leave it.
	 */
	clearFilter(): void {
		this.filter = { ...emptyFilter(), competition: this.filter.competition };
		this.cursor = 0;
	}

	/** Switch competition, dropping anything scoped under the previous one. */
	setActiveCompetition(slug: string | null): void {
		this.setFilter({ competition: slug, wave: null, scenarioCode: null, model: null });
	}

	toast(text: string, kind: Toast['kind'] = 'info', failures: ImportFailure[] = []): number {
		const id = nextToastId++;
		this.toasts = [...this.toasts, { id, text, kind, failures, expanded: false }];
		if (failures.length === 0) {
			setTimeout(() => this.dismiss(id), 6000);
		}
		return id;
	}

	dismiss(id: number): void {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	toggleToast(id: number): void {
		this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t));
	}
}

export const ui = new Ui();
