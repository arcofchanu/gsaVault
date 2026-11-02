<script lang="ts">
	import { ui } from '$lib/store/ui.svelte';
	import { vault } from '$lib/store/vault.svelte';
	import type { VaultTree } from '$lib/stats';

	/**
	 * Every competition, always — the sidebar is not narrowed by the active
	 * competition, because it is also where waves are moved between them.
	 */
	let { tree, total }: { tree: VaultTree; total: number } = $props();

	/**
	 * Expansion state by node key. Competitions and waves default to open,
	 * scenarios to closed — the model level is only interesting once you are
	 * drilling into one scenario.
	 */
	let toggled = $state<Record<string, boolean>>({});

	function isOpen(key: string, fallback: boolean): boolean {
		return toggled[key] ?? fallback;
	}

	function toggle(key: string, fallback: boolean) {
		toggled = { ...toggled, [key]: !isOpen(key, fallback) };
	}

	const filter = $derived(ui.filter);

	/* ---- renaming a competition ---- */

	let renaming = $state<string | null>(null);
	let nameDraft = $state('');

	function startRename(slug: string, current: string) {
		renaming = slug;
		nameDraft = current;
	}

	/**
	 * Stored against the slug, so every submission in the group follows and the
	 * rename travels in the JSON bundle. Clearing the field restores the name the
	 * exports carry.
	 */
	async function commitRename(slug: string) {
		if (renaming !== slug) return;
		const name = nameDraft;
		renaming = null;
		await vault.setCompetitionName(slug, name.trim() === '' ? null : name);
	}

	function selectAll() {
		ui.setActiveCompetition(null);
	}

	/* ---- creating and deleting competitions ---- */

	let creating = $state(false);
	let newName = $state('');

	async function commitNew() {
		if (!creating) return;
		const name = newName.trim();
		creating = false;
		newName = '';
		if (name === '') return;
		const competition = await vault.createCompetition(name);
		if (competition !== null) {
			ui.setActiveCompetition(competition.slug);
			ui.toast(`competition "${competition.name}" ready · drops now go here`);
		}
	}

	async function remove(slug: string, name: string) {
		if (!(await vault.deleteCompetition(slug))) return;
		if (ui.filter.competition === slug) ui.setActiveCompetition(null);
		ui.toast(`removed empty competition "${name}"`);
	}

	/* ---- moving a whole wave to another competition ---- */

	const WAVE_TYPE = 'application/x-gsa-wave';

	/** The wave being dragged, so drop targets can light up and refuse itself. */
	let dragged = $state<{ from: string; wave: string } | null>(null);
	let dropOn = $state<string | null>(null);
	/** Wave whose "move to" picker is open: `slug::wave`. */
	let moving = $state<string | null>(null);

	async function move(from: string, wave: string, to: string) {
		moving = null;
		const toName = tree.find((c) => c.slug === to)?.name ?? to;
		const n = await vault.moveWave(from, wave, to);
		if (n === 0) return;
		// The wave left the competition being looked at; do not strand the view on it.
		if (ui.filter.competition === from && ui.filter.wave === wave) {
			ui.setFilter({ wave: null, scenarioCode: null, model: null });
		}
		ui.toast(`moved wave ${wave} · ${n} submission${n === 1 ? '' : 's'} → ${toName}`);
	}

	function dragStart(event: DragEvent, from: string, wave: string) {
		if (event.dataTransfer === null) return;
		event.dataTransfer.setData(WAVE_TYPE, JSON.stringify({ from, wave }));
		event.dataTransfer.effectAllowed = 'move';
		dragged = { from, wave };
	}

	function dragEnd() {
		dragged = null;
		dropOn = null;
	}

	function dragOver(event: DragEvent, slug: string) {
		if (dragged === null || dragged.from === slug) return;
		event.preventDefault();
		if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
		dropOn = slug;
	}

	function dragLeave(event: DragEvent, slug: string) {
		const next = event.relatedTarget;
		if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
		if (dropOn === slug) dropOn = null;
	}

	async function drop(event: DragEvent, slug: string) {
		if (dragged === null) return; // a file drop: leave it to the window handler
		event.preventDefault();
		event.stopPropagation();
		const source = dragged;
		dragEnd();
		if (source.from === slug) return;
		await move(source.from, source.wave, slug);
	}
</script>

<nav class="tree" aria-label="Vault hierarchy">
	<button
		class="node node--all"
		class:is-current={filter.competition === null}
		onclick={selectAll}
		type="button"
	>
		<span class="name">ALL SUBMISSIONS</span>
		<span class="count">{total}</span>
	</button>

	{#each tree as competition (competition.slug)}
		{@const compKey = competition.slug}
		{@const compOpen = isOpen(compKey, true)}
		<div
			class="group"
			class:is-drop={dropOn === competition.slug}
			role="group"
			aria-label={competition.name}
			ondragover={(e) => dragOver(e, competition.slug)}
			ondragleave={(e) => dragLeave(e, competition.slug)}
			ondrop={(e) => drop(e, competition.slug)}
		>
			<div class="row" class:is-current={filter.competition === competition.slug && filter.wave === null && filter.scenarioCode === null}>
				<button
					class="twist"
					onclick={() => toggle(compKey, true)}
					type="button"
					aria-expanded={compOpen}
					aria-label={compOpen ? 'Collapse' : 'Expand'}>{compOpen ? '−' : '+'}</button
				>
				{#if renaming === competition.slug}
					<input
						class="rename"
						type="text"
						bind:value={nameDraft}
						aria-label="Competition name"
						onkeydown={(e) => {
							if (e.key === 'Enter') void commitRename(competition.slug);
							if (e.key === 'Escape') renaming = null;
						}}
						onblur={() => void commitRename(competition.slug)}
					/>
				{:else}
					<button
						class="node node--comp"
						onclick={() => ui.setActiveCompetition(competition.slug)}
						type="button"
					>
						<span class="name">{competition.name}</span>
						<span class="count">{competition.count}</span>
					</button>
					<button
						class="rename-btn"
						onclick={() => startRename(competition.slug, competition.name)}
						type="button"
						title="Rename this competition"
						aria-label="Rename {competition.name}">edit</button
					>
					{#if competition.count === 0}
						<button
							class="rename-btn"
							onclick={() => void remove(competition.slug, competition.name)}
							type="button"
							title="Remove this empty competition"
							aria-label="Remove {competition.name}">×</button
						>
					{/if}
				{/if}
			</div>

			{#if competition.waves.length === 0}
				<p class="empty-comp">
					{dragged !== null && dragged.from !== competition.slug
						? 'drop the wave here'
						: 'empty · drop files or drag a wave here'}
				</p>
			{/if}

			{#if compOpen}
				{#each competition.waves as wave (wave.wave)}
					{@const waveKey = `${compKey}::${wave.wave}`}
					{@const waveOpen = isOpen(waveKey, true)}
					<div class="level level--1">
						<div
							class="row row--wave"
							class:is-current={filter.competition === competition.slug && filter.wave === wave.wave && filter.scenarioCode === null}
							class:is-dragged={dragged?.from === competition.slug && dragged.wave === wave.wave}
							draggable={tree.length > 1 ? 'true' : 'false'}
							ondragstart={(e) => dragStart(e, competition.slug, wave.wave)}
							ondragend={dragEnd}
							role="listitem"
							title={tree.length > 1 ? 'Drag onto another competition to move this wave' : undefined}
						>
							<button
								class="twist"
								onclick={() => toggle(waveKey, true)}
								type="button"
								aria-expanded={waveOpen}
								aria-label={waveOpen ? 'Collapse' : 'Expand'}>{waveOpen ? '−' : '+'}</button
							>
							<button
								class="node"
								onclick={() => ui.setFilter({ competition: competition.slug, wave: wave.wave, scenarioCode: null, model: null })}
								type="button"
							>
								<span class="name">WAVE {wave.wave}</span>
								<span class="count">{wave.count}</span>
							</button>
							{#if tree.length > 1}
								<button
									class="rename-btn"
									onclick={() => (moving = moving === waveKey ? null : waveKey)}
									type="button"
									title="Move this wave to another competition"
									aria-label="Move wave {wave.wave}">move</button
								>
							{/if}
						</div>

						{#if moving === waveKey}
							<div class="move">
								<select
									class="move__select"
									aria-label="Move wave {wave.wave} to"
									onchange={(e) => {
										const to = e.currentTarget.value;
										if (to !== '') void move(competition.slug, wave.wave, to);
									}}
									onkeydown={(e) => {
										if (e.key === 'Escape') {
											e.stopPropagation();
											moving = null;
										}
									}}
								>
									<option value="">move wave {wave.wave} to…</option>
									{#each tree.filter((c) => c.slug !== competition.slug) as other (other.slug)}
										<option value={other.slug}>{other.name}</option>
									{/each}
								</select>
								<button class="ghost" onclick={() => (moving = null)} type="button" aria-label="Cancel move">×</button>
							</div>
						{/if}

						{#if waveOpen}
							{#each wave.scenarios as scenario (scenario.code)}
								{@const scKey = `${waveKey}::${scenario.code}`}
								{@const scOpen = isOpen(scKey, false)}
								<div class="level level--2">
									<div class="row" class:is-current={filter.scenarioCode === scenario.code && filter.model === null}>
										<button
											class="twist"
											onclick={() => toggle(scKey, false)}
											type="button"
											aria-expanded={scOpen}
											aria-label={scOpen ? 'Collapse' : 'Expand'}>{scOpen ? '−' : '+'}</button
										>
										<button
											class="node"
											onclick={() => ui.setFilter({ competition: competition.slug, wave: wave.wave, scenarioCode: scenario.code, model: null })}
											type="button"
											title={scenario.full}
										>
											<span class="name"><span class="code">{scenario.code}</span> {scenario.label}</span>
											<span class="count">{scenario.count}</span>
										</button>
									</div>

									{#if scOpen}
										{#each scenario.models as model (model.model)}
											<div class="level level--3">
												<button
													class="node node--model"
													class:is-current={filter.scenarioCode === scenario.code && filter.model === model.model}
													onclick={() => ui.setFilter({ competition: competition.slug, wave: wave.wave, scenarioCode: scenario.code, model: model.model })}
													type="button"
												>
													<span class="name">{model.model}</span>
													<span class="count">{model.count}</span>
												</button>
											</div>
										{/each}
									{/if}
								</div>
							{/each}
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/each}

	{#if tree.length === 0}
		<p class="empty-comp">nothing imported yet</p>
	{/if}

	<div class="new">
		{#if creating}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="rename new__input"
				type="text"
				bind:value={newName}
				placeholder="COMPETITION NAME"
				aria-label="New competition name"
				autofocus
				onkeydown={(e) => {
					if (e.key === 'Enter') void commitNew();
					if (e.key === 'Escape') {
						e.stopPropagation();
						creating = false;
					}
				}}
				onblur={() => void commitNew()}
			/>
		{:else}
			<button class="node new__btn" onclick={() => (creating = true)} type="button">
				<span class="name">+ new competition</span>
			</button>
		{/if}
	</div>

	{#if tree.length > 1}
		<p class="hint muted">drag a wave onto another competition to move it</p>
	{/if}
</nav>

<style>
	.tree {
		display: flex;
		flex-direction: column;
		font-size: var(--fs-sm);
	}

	.group {
		border-top: 1px solid var(--line);
		padding: var(--gap-1) 0;
	}

	.row {
		display: flex;
		align-items: stretch;
		border-left: 2px solid transparent;
	}

	/* Active nav item: 2px red left bar (PRD §5). */
	.row.is-current,
	.node.is-current {
		border-left: 2px solid var(--red);
		background: linear-gradient(90deg, rgba(225, 6, 0, 0.12) 0%, transparent 70%);
	}

	.node {
		flex: 1;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--gap-2);
		min-width: 0;
		padding: var(--gap-2) var(--gap-3) var(--gap-2) var(--gap-2);
		background: transparent;
		border: 0;
		border-left: 2px solid transparent;
		text-align: left;
		text-transform: none;
		letter-spacing: 0;
		font-size: var(--fs-sm);
		color: var(--text);
	}

	.node:hover:not(:disabled) {
		border-color: transparent;
		color: var(--red);
	}

	.node--all {
		border-top: 0;
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-xs);
		color: var(--muted);
		padding: var(--gap-3);
	}

	.node--comp .name {
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-xs);
	}

	.node--model .name {
		color: var(--muted);
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.code {
		color: var(--red);
	}

	.count {
		flex: none;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-xs);
	}

	.rename-btn {
		flex: none;
		align-self: stretch;
		padding: 0 var(--gap-2);
		background: transparent;
		border: 0;
		color: var(--muted);
		font-size: var(--fs-xs);
		letter-spacing: var(--track);
		opacity: 0;
	}

	/* Revealed on hover or focus so the tree stays quiet at rest. */
	.row:hover .rename-btn,
	.rename-btn:focus-visible {
		opacity: 1;
	}

	.rename-btn:hover {
		color: var(--red);
		border-color: transparent;
	}

	.rename {
		flex: 1;
		min-width: 0;
		margin: 2px var(--gap-2) 2px 0;
		padding: 2px var(--gap-2);
		font-size: var(--fs-sm);
		border-color: var(--red);
	}

	/* ---- wave moves ---- */

	.group.is-drop {
		outline: 1px dashed var(--red);
		outline-offset: -1px;
		background: linear-gradient(90deg, rgba(225, 6, 0, 0.16) 0%, transparent 80%);
	}

	.row--wave[draggable='true'] {
		cursor: grab;
	}

	.row.is-dragged {
		opacity: 0.45;
	}

	.empty-comp {
		margin: 0;
		padding: var(--gap-1) var(--gap-3) var(--gap-2) calc(20px + var(--gap-2));
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.group.is-drop .empty-comp {
		color: var(--red);
	}

	.move {
		display: flex;
		gap: var(--gap-1);
		padding: 0 var(--gap-2) var(--gap-2) 20px;
	}

	.move__select {
		flex: 1;
		min-width: 0;
		padding: 2px var(--gap-2);
		background: var(--surface);
		border-color: var(--red);
		font-size: var(--fs-xs);
	}

	.new {
		border-top: 1px solid var(--line);
		padding: var(--gap-1) 0;
	}

	.new__btn .name {
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-xs);
	}

	.new__btn:hover .name {
		color: var(--red);
	}

	.new__input {
		width: calc(100% - var(--gap-4));
		margin: var(--gap-1) var(--gap-2);
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-xs);
	}

	.hint {
		margin: 0;
		padding: var(--gap-2) var(--gap-3);
		font-size: var(--fs-xs);
	}

	.twist {
		flex: none;
		width: 20px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--muted);
		font-size: var(--fs-base);
		line-height: 1;
	}
	.twist:hover:not(:disabled) {
		color: var(--red);
		border-color: transparent;
	}

	.level--1 {
		padding-left: var(--gap-3);
	}
	.level--2 {
		padding-left: var(--gap-3);
	}
	.level--3 {
		padding-left: var(--gap-5);
	}
</style>
