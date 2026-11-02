<script lang="ts">
	import { isProfileEmpty } from '$lib/profile';
	import { ui } from '$lib/store/ui.svelte';
	import { vault } from '$lib/store/vault.svelte';
	import type { Mode } from '$lib/types';

	let {
		onbrowse,
		onpaste,
		onexportpdf,
		onexportjson,
		onprofile,
		onclear,
		exportable
	}: {
		onbrowse: () => void;
		onpaste: () => void;
		onexportpdf: () => void;
		onexportjson: () => void;
		onprofile: () => void;
		onclear: () => void;
		exportable: number;
	} = $props();

	let confirming = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	const mode = $derived(vault.settings.defaultMode);
	const hasProfile = $derived(!isProfileEmpty(vault.profile));

	function setMode(next: Mode) {
		void vault.setDefaultMode(next);
	}

	/* ---- the active competition: where drops go, what the home page shows ---- */

	const AUTO = '__auto__';
	const NEW = '__new__';

	let naming = $state(false);
	let draft = $state('');

	const active = $derived(ui.filter.competition);

	function chooseTarget(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const value = select.value;
		if (value === NEW) {
			// Snap the select back; it re-renders once a name is committed.
			select.value = active ?? AUTO;
			draft = '';
			naming = true;
			return;
		}
		naming = false;
		ui.setActiveCompetition(value === AUTO ? null : value);
	}

	/** Creates (and saves) the competition, then makes it the active one. */
	async function commitName() {
		if (!naming) return;
		const name = draft.trim();
		naming = false;
		if (name === '') return;
		const competition = await vault.createCompetition(name);
		if (competition !== null) ui.setActiveCompetition(competition.slug);
	}

	function clear() {
		if (!confirming) {
			confirming = true;
			clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() => (confirming = false), 4000);
			return;
		}
		confirming = false;
		clearTimeout(confirmTimer);
		onclear();
	}
</script>

<header class="bar">
	<button
		class="ghost drawer"
		onclick={() => (ui.drawerOpen = !ui.drawerOpen)}
		type="button"
		aria-label="Toggle hierarchy"
	>
		≡
	</button>

	<a class="brand" href="#top">
		<span class="brand__mark" aria-hidden="true"></span>
		<span class="brand__text">GSA&nbsp;VAULT</span>
	</a>

	<div class="search">
		<label class="sr-only" for="vault-search">Search submissions</label>
		<input
			id="vault-search"
			type="search"
			placeholder="SEARCH SCENARIO · MODEL · TASK · PAYLOAD"
			value={ui.filter.query}
			oninput={(e) => ui.setFilter({ query: e.currentTarget.value })}
			autocomplete="off"
			spellcheck="false"
		/>
		<span class="search__key" aria-hidden="true">/</span>
	</div>

	<div class="toggle" role="group" aria-label="Mode stamped on the next drop">
		<button
			class:is-active={mode === 'single'}
			onclick={() => setMode('single')}
			type="button"
			title="Next drop is stamped single-turn">single-turn</button
		>
		<button
			class:is-active={mode === 'multi'}
			onclick={() => setMode('multi')}
			type="button"
			title="Next drop is stamped multi-turn">multi-turn</button
		>
	</div>

	<div class="into" role="group" aria-label="Competition the next import is filed under">
		<span class="into__label">into</span>
		{#if naming}
			<input
				class="into__new"
				type="text"
				bind:value={draft}
				placeholder="COMPETITION NAME"
				aria-label="New competition name"
				onkeydown={(e) => {
					if (e.key === 'Enter') void commitName();
					if (e.key === 'Escape') {
						e.stopPropagation();
						naming = false;
					}
				}}
				onblur={() => void commitName()}
			/>
		{:else}
			<select
				class="into__select"
				class:is-set={active !== null}
				value={active ?? AUTO}
				onchange={chooseTarget}
				aria-label="Active competition"
				title="Drops are filed under this competition, and the home page shows only it"
			>
				<option value={AUTO}>all · file by challenge</option>
				{#each vault.competitions as competition (competition.slug)}
					<option value={competition.slug}>{competition.name}</option>
				{/each}
				<option value={NEW}>new competition…</option>
			</select>
		{/if}
	</div>

	<div class="actions">
		<button onclick={onbrowse} type="button">browse</button>
		<button onclick={onpaste} type="button">paste</button>
		<button class:is-active={hasProfile} onclick={onprofile} type="button" title="Researcher details printed on the PDF cover">profile</button>

		<button onclick={onexportpdf} disabled={exportable === 0 || ui.busy !== null} type="button">
			pdf
		</button>
		<button onclick={onexportjson} disabled={exportable === 0} type="button">json</button>
		<button class="danger" class:is-active={confirming} onclick={clear} type="button">
			{confirming ? 'confirm clear' : 'clear vault'}
		</button>
	</div>

	{#if ui.busy !== null}
		<div class="busy"><span class="busy__text">{ui.busy}</span></div>
	{/if}
</header>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: var(--gap-3);
		min-height: var(--header-h);
		padding: var(--gap-2) var(--gap-4);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	/* Red edge under the sticky header. */
	.bar::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 1px;
		background: var(--grad-edge);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--gap-2);
		flex: none;
	}

	.brand__mark {
		width: 10px;
		height: 18px;
		background: var(--grad-red-v);
	}

	.brand__text {
		font-weight: 700;
		letter-spacing: var(--track);
		font-size: var(--fs-md);
		white-space: nowrap;
	}

	.search {
		position: relative;
		flex: 1;
		min-width: 140px;
	}

	.search input {
		padding-right: 28px;
		font-size: var(--fs-sm);
		letter-spacing: var(--track);
	}

	.search__key {
		position: absolute;
		right: var(--gap-2);
		top: 50%;
		transform: translateY(-50%);
		color: var(--muted);
		font-size: var(--fs-xs);
		border: 1px solid var(--line);
		padding: 0 4px;
		pointer-events: none;
	}

	.toggle {
		display: flex;
		flex: none;
	}

	.toggle button + button {
		border-left: 0;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--gap-2);
		flex: none;
	}

	.into {
		display: flex;
		align-items: center;
		gap: var(--gap-2);
		flex: none;
	}

	.into__label {
		color: var(--muted);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.into__select,
	.into__new {
		max-width: 190px;
		padding: var(--gap-2);
		background: var(--surface);
		font-size: var(--fs-xs);
		letter-spacing: var(--track);
		text-transform: uppercase;
	}

	.into__select:hover,
	.into__new:hover {
		border-color: var(--red);
	}

	/* A chosen target changes where files land — make it obviously not "auto". */
	.into__select.is-set {
		border-color: var(--red);
		color: var(--red);
	}

	.into__new {
		width: 190px;
		border-color: var(--red);
	}

	.drawer {
		display: none;
		font-size: var(--fs-lg);
		line-height: 1;
	}

	.busy {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		background: var(--line);
		overflow: hidden;
	}

	.busy::before {
		content: '';
		position: absolute;
		inset: 0;
		width: 40%;
		background: var(--grad-red);
		animation: sweep 1.1s linear infinite;
	}

	.busy__text {
		position: absolute;
		left: -9999px;
	}

	@keyframes sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(350%);
		}
	}

	@media (max-width: 1280px) {
		.search {
			order: 10;
			flex-basis: 100%;
		}
		.bar {
			flex-wrap: wrap;
		}
	}

	@media (max-width: 900px) {
		.drawer {
			display: block;
		}
	}
</style>
