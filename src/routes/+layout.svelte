<script lang="ts">
	import { onMount } from 'svelte';
	import { preloadCode } from '$app/navigation';
	import { base } from '$app/paths';
	import '../app.css';
	import DropOverlay from '$lib/components/DropOverlay.svelte';
	import ExportModal, { type ExportChoice } from '$lib/components/ExportModal.svelte';
	import Header from '$lib/components/Header.svelte';
	import PasteModal from '$lib/components/PasteModal.svelte';
	import ProfileModal from '$lib/components/ProfileModal.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import TreeSidebar from '$lib/components/TreeSidebar.svelte';
	import { buildBundle, bundleFilename, serializeBundle } from '$lib/export/bundle';
	import { summarize } from '$lib/parse/import';
	import { applyFilter, describeFilter, sortSubmissions } from '$lib/stats';
	import type { Competition, Submission } from '$lib/types';
	import { ui } from '$lib/store/ui.svelte';
	import { vault } from '$lib/store/vault.svelte';
	import { downloadBlob, downloadText } from '$lib/util/download';
	import type { ImportResult } from '$lib/types';
	import type { Profile } from '$lib/profile';

	let { children } = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	/** dragenter/dragleave fire per element; count them so the overlay is stable. */
	let dragDepth = 0;

	/** The active competition, if one is picked in the header's "into" field. */
	const target = $derived<Competition | null>(
		vault.competitions.find((c) => c.slug === ui.filter.competition) ?? null
	);

	/* ---- export: always asks which competition ---- */

	const VIEW = '__view__';
	const ALL = '__all__';

	/** True when the filter narrows further than just picking a competition. */
	const viewIsNarrower = $derived(
		ui.filter.wave !== null ||
			ui.filter.scenarioCode !== null ||
			ui.filter.model !== null ||
			ui.filter.mode !== null ||
			ui.filter.query.trim() !== ''
	);

	const exportChoices = $derived.by((): ExportChoice[] => {
		const out: ExportChoice[] = [];
		if (viewIsNarrower) {
			out.push({
				key: VIEW,
				label: describeFilter(ui.filter, vault.sidebarTree),
				hint: 'current view',
				count: applyFilter(vault.list, ui.filter).length
			});
		}
		for (const node of vault.sidebarTree) {
			out.push({
				key: node.slug,
				label: node.name,
				hint: node.waves.length === 0 ? 'empty' : `${node.waves.length} wave${node.waves.length === 1 ? '' : 's'}`,
				count: node.count
			});
		}
		out.push({ key: ALL, label: 'every competition', hint: 'whole vault', count: vault.count });
		return out;
	});

	/** Pre-selected: the current view, else the active competition, else everything. */
	const exportInitial = $derived(viewIsNarrower ? VIEW : (target?.slug ?? ALL));

	function exportSetFor(key: string): { set: Submission[]; label: string } {
		if (key === VIEW) {
			return {
				set: sortSubmissions(applyFilter(vault.list, ui.filter)),
				label: describeFilter(ui.filter, vault.sidebarTree)
			};
		}
		if (key === ALL) return { set: sortSubmissions(vault.list), label: 'all submissions' };
		const name = vault.competitions.find((c) => c.slug === key)?.name ?? key;
		return {
			set: sortSubmissions(vault.list.filter((s) => s.competition.slug === key)),
			label: name
		};
	}

	function runExport(key: string) {
		const kind = ui.exportOpen;
		ui.exportOpen = null;
		if (kind === 'json') exportJson(key);
		else if (kind === 'pdf') void exportPdf(key);
	}

	// The input is owned here; anywhere in the app can open it via `ui.pickFiles`.
	// The closure resolves `fileInput` at call time, after it has been bound.
	ui.registerFilePicker(() => fileInput?.click());

	onMount(() => {
		void vault.init();

		// Pull in everything the app will ever need while the browser is idle —
		// the PDF chunk (pdfmake + embedded fonts, ~2 MB) and the detail route's
		// code — so that from here on the app issues no requests at all. Idle
		// rather than eager so none of it competes with first paint. See NETWORK.md.
		const warm = () => {
			void import('$lib/export/pdf').catch(() => undefined);
			void preloadCode(`${base}/s/_`).catch(() => undefined);
		};
		const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
			.requestIdleCallback;
		if (typeof idle === 'function') idle(warm);
		else setTimeout(warm, 1500);
	});

	function report(result: ImportResult) {
		const warn = result.failed.length > 0;
		ui.toast(summarize(result), warn ? 'warn' : 'info', result.failed);
	}

	async function ingest(files: readonly File[]) {
		if (files.length === 0) return;
		ui.busy = `importing ${files.length} file${files.length === 1 ? '' : 's'}…`;
		try {
			report(await vault.importFiles(files, vault.settings.defaultMode, target));
		} finally {
			ui.busy = null;
		}
	}

	function ondragover(event: DragEvent) {
		// Without preventDefault the browser refuses the drop.
		if (event.dataTransfer?.types.includes('Files')) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
		}
	}

	function ondragenter(event: DragEvent) {
		if (!event.dataTransfer?.types.includes('Files')) return;
		dragDepth++;
		ui.dragging = true;
	}

	function ondragleave() {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) ui.dragging = false;
	}

	async function ondrop(event: DragEvent) {
		event.preventDefault();
		dragDepth = 0;
		ui.dragging = false;
		await ingest([...(event.dataTransfer?.files ?? [])]);
	}

	async function onpicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		await ingest([...(input.files ?? [])]);
		input.value = ''; // so picking the same file again re-fires change
	}

	async function onpastesubmit(text: string) {
		ui.pasteOpen = false;
		ui.busy = 'importing pasted JSON…';
		try {
			report(await vault.importText(text, 'pasted.json', vault.settings.defaultMode, target));
		} finally {
			ui.busy = null;
		}
	}

	function exportJson(key: string) {
		const { set: exportSet } = exportSetFor(key);
		const exportedAt = new Date().toISOString();
		const bundle = buildBundle(
			exportSet,
			vault.waveOverrides,
			vault.competitionNames,
			vault.profile,
			vault.settings,
			exportedAt,
			// A whole-vault backup keeps empty competitions too.
			key === ALL ? vault.registry : vault.registry.filter((c) => c.slug === key)
		);
		downloadText(serializeBundle(bundle), bundleFilename(exportedAt));
		ui.toast(`exported ${bundle.submissions.length} submissions as JSON`);
	}

	async function exportPdf(key: string) {
		const { set: exportSet, label } = exportSetFor(key);
		const exportedAt = new Date().toISOString();
		ui.busy = 'building PDF…';
		try {
			const { generatePdf, pdfFilename } = await import('$lib/export/pdf');
			const blob = await generatePdf(
				{ submissions: exportSet, scopeLabel: label, exportedAt, profile: vault.profile },
				(pct) => (ui.busy = `building PDF… ${pct}%`)
			);
			downloadBlob(blob, pdfFilename(exportSet, exportedAt));
			ui.toast(`exported ${exportSet.length} submissions as PDF`);
		} catch (err) {
			ui.toast(`PDF export failed: ${(err as Error).message}`, 'warn');
		} finally {
			ui.busy = null;
		}
	}

	async function saveProfile(profile: Profile) {
		ui.profileOpen = false;
		await vault.setProfile(profile);
		ui.toast('profile saved · it appears on the pdf cover');
	}

	async function clearVault() {
		const n = vault.count;
		await vault.clearAll();
		ui.clearFilter();
		ui.setActiveCompetition(null);
		ui.toast(`vault cleared · ${n} submissions removed`, 'warn');
	}

	function onkeydown(event: KeyboardEvent) {
		const target = event.target;
		const typing =
			target instanceof HTMLElement &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

		if (event.key === '/' && !typing) {
			event.preventDefault();
			document.getElementById('vault-search')?.focus();
			return;
		}
		if (event.key === 'Escape') {
			if (ui.pasteOpen) {
				ui.pasteOpen = false;
				return;
			}
			if (ui.profileOpen) {
				ui.profileOpen = false;
				return;
			}
			if (ui.exportOpen !== null) {
				ui.exportOpen = null;
				return;
			}
			if (typing && target instanceof HTMLElement) target.blur();
		}
	}
</script>

<svelte:window {ondragover} {ondragenter} {ondragleave} {ondrop} {onkeydown} />

<div class="shell" id="top">
	<Header
		onbrowse={() => ui.pickFiles()}
		onpaste={() => (ui.pasteOpen = true)}
		onexportpdf={() => (ui.exportOpen = 'pdf')}
		onexportjson={() => (ui.exportOpen = 'json')}
		onprofile={() => (ui.profileOpen = true)}
		onclear={clearVault}
		exportable={vault.count}
	/>

	{#if vault.storageError !== null}
		<p class="storage-error">{vault.storageError} — the vault works but will not survive a reload.</p>
	{/if}

	<div class="body">
		<aside class="sidebar" class:is-open={ui.drawerOpen}>
			<div class="sidebar__head">
				<span class="label">// hierarchy</span>
				<button class="ghost close" onclick={() => (ui.drawerOpen = false)} type="button">×</button>
			</div>
			<TreeSidebar tree={vault.sidebarTree} total={vault.count} />
		</aside>

		{#if ui.drawerOpen}
			<button class="scrim" onclick={() => (ui.drawerOpen = false)} aria-label="Close hierarchy"
			></button>
		{/if}

		<main class="main">
			{@render children()}
		</main>
	</div>
</div>

<input
	bind:this={fileInput}
	class="sr-only"
	type="file"
	multiple
	accept=".json,.zip,application/json,application/zip"
	onchange={onpicked}
	tabindex="-1"
/>

{#if ui.dragging}
	<DropOverlay mode={vault.settings.defaultMode} competition={target?.name ?? null} />
{/if}

{#if ui.pasteOpen}
	<PasteModal onsubmit={onpastesubmit} onclose={() => (ui.pasteOpen = false)} />
{/if}

{#if ui.exportOpen !== null}
	<ExportModal
		kind={ui.exportOpen}
		choices={exportChoices}
		initial={exportInitial}
		onconfirm={runExport}
		onclose={() => (ui.exportOpen = null)}
	/>
{/if}

{#if ui.profileOpen}
	<ProfileModal
		profile={vault.profile}
		onsave={saveProfile}
		onclose={() => (ui.profileOpen = false)}
	/>
{/if}

<Toasts />

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.body {
		position: relative;
		flex: 1;
		display: grid;
		grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
		align-items: start;
	}

	.sidebar {
		position: sticky;
		top: var(--header-h);
		align-self: start;
		max-height: calc(100vh - var(--header-h));
		overflow-y: auto;
		border-right: 1px solid var(--line);
		background: var(--surface);
	}

	.sidebar__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--gap-3);
		border-bottom: 1px solid var(--line);
	}

	.sidebar__head .label {
		margin-bottom: 0;
	}

	.close {
		display: none;
	}

	.main {
		min-width: 0;
		padding: var(--gap-4);
	}

	.storage-error {
		margin: 0;
		padding: var(--gap-2) var(--gap-4);
		border-bottom: 1px solid var(--red);
		background: var(--red-dim);
		font-size: var(--fs-sm);
	}

	.scrim {
		display: none;
	}

	@media (max-width: 900px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}

		.sidebar {
			position: fixed;
			z-index: 70;
			top: 0;
			bottom: 0;
			left: 0;
			width: min(var(--sidebar-w), 86vw);
			max-height: none;
			transform: translateX(-100%);
			transition: transform 0.12s linear;
			border-right: 1px solid var(--red);
		}

		.sidebar.is-open {
			transform: translateX(0);
		}

		.close {
			display: block;
		}

		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 65;
			background: rgba(10, 10, 10, 0.72);
			border: 0;
			padding: 0;
		}
	}
</style>
