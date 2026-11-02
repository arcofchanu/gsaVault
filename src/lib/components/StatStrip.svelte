<script lang="ts">
	import CountUp from '$lib/components/CountUp.svelte';
	import type { VaultStats } from '$lib/stats';

	let { stats }: { stats: VaultStats } = $props();

	const cells = $derived([
		{ label: 'breaks', value: stats.total, accent: true },
		{ label: 'competitions', value: stats.competitions, accent: false },
		{ label: 'scenarios', value: stats.scenarios, accent: false },
		{ label: 'models', value: stats.models, accent: false },
		{ label: 'waves', value: stats.waves, accent: false }
	]);
</script>

<div class="strip">
	{#each cells as cell (cell.label)}
		<div class="cell" class:accent={cell.accent}>
			<span class="value"><CountUp value={cell.value} /></span>
			<span class="label">{cell.label}</span>
		</div>
	{/each}
</div>

<style>
	.strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		border: 1px solid var(--line);
		background: var(--grad-surface);
	}

	.cell {
		padding: var(--gap-4);
		border-left: 1px solid var(--line);
		transition: border-color 0.1s linear;
	}

	.cell:first-child {
		border-left: 2px solid var(--red);
	}

	.cell.accent .value {
		color: var(--red);
	}

	.value {
		display: block;
		font-size: var(--fs-2xl);
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.label {
		display: block;
		margin-top: var(--gap-2);
		color: var(--muted);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}
</style>
