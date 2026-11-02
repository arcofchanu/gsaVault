<script lang="ts">
	import { ui } from '$lib/store/ui.svelte';
	import { isFilterActive } from '$lib/stats';
	import type { VaultTree } from '$lib/stats';
	import type { Filter } from '$lib/stats';

	let { tree, shown, total }: { tree: VaultTree; shown: number; total: number } = $props();

	const filter = $derived(ui.filter);

	const chips = $derived.by(() => {
		const out: { key: keyof Filter; label: string; clear: Partial<Filter> }[] = [];
		if (filter.competition !== null) {
			const name = tree.find((c) => c.slug === filter.competition)?.name ?? filter.competition;
			out.push({
				key: 'competition',
				label: name,
				// Dropping the competition drops everything scoped under it, and
				// switches the header's "into" back to every competition.
				clear: { competition: null, wave: null, scenarioCode: null, model: null }
			});
		}
		if (filter.wave !== null) {
			out.push({ key: 'wave', label: `wave ${filter.wave}`, clear: { wave: null, scenarioCode: null, model: null } });
		}
		if (filter.scenarioCode !== null) {
			out.push({ key: 'scenarioCode', label: filter.scenarioCode, clear: { scenarioCode: null, model: null } });
		}
		if (filter.model !== null) {
			out.push({ key: 'model', label: filter.model, clear: { model: null } });
		}
		if (filter.mode !== null) {
			out.push({ key: 'mode', label: `${filter.mode}-turn`, clear: { mode: null } });
		}
		if (filter.query.trim() !== '') {
			out.push({ key: 'query', label: `"${filter.query.trim()}"`, clear: { query: '' } });
		}
		return out;
	});

	// The competition is the active one, not a filter: "clear all" leaves it.
	const active = $derived(isFilterActive({ ...filter, competition: null }));
</script>

<div class="chips">
	<span class="muted shown">
		{shown}{#if shown !== total}<span class="muted"> / {total}</span>{/if} shown
	</span>

	{#each chips as chip (chip.key)}
		<button class="chip" onclick={() => ui.setFilter(chip.clear)} type="button" title="Remove filter">
			<span class="chip__label">{chip.label}</span><span class="chip__x">×</span>
		</button>
	{/each}

	<div class="modes">
		<button
			class="chip"
			class:is-active={filter.mode === 'single'}
			onclick={() => ui.setFilter({ mode: filter.mode === 'single' ? null : 'single' })}
			type="button">single</button
		>
		<button
			class="chip"
			class:is-active={filter.mode === 'multi'}
			onclick={() => ui.setFilter({ mode: filter.mode === 'multi' ? null : 'multi' })}
			type="button">multi</button
		>
	</div>

	{#if active}
		<button class="ghost clear" onclick={() => ui.clearFilter()} type="button">clear all</button>
	{/if}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--gap-2);
	}

	.shown {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
		margin-right: var(--gap-2);
		font-variant-numeric: tabular-nums;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--gap-2);
		padding: 2px var(--gap-2);
		font-size: var(--fs-xs);
		background: var(--surface);
		border: 1px solid var(--line);
		max-width: 260px;
	}

	.chip__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip__x {
		color: var(--muted);
	}

	.chip:hover .chip__x {
		color: var(--red);
	}

	.modes {
		display: flex;
		gap: 0;
		margin-left: auto;
	}
	.modes .chip + .chip {
		border-left: 0;
	}

	.clear {
		font-size: var(--fs-xs);
	}
</style>
