<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import Bar from '$lib/charts/Bar.svelte';
	import Heatmap from '$lib/charts/Heatmap.svelte';
	import Timeline from '$lib/charts/Timeline.svelte';
	import FilterChips from '$lib/components/FilterChips.svelte';
	import StatStrip from '$lib/components/StatStrip.svelte';
	import SubmissionCard from '$lib/components/SubmissionCard.svelte';
	import { applyFilter, computeStats, sortSubmissions } from '$lib/stats';
	import { ui } from '$lib/store/ui.svelte';
	import { vault } from '$lib/store/vault.svelte';
	import { formatDate } from '$lib/util/text';

	/**
	 * Cards are rendered incrementally rather than all at once: a sentinel at the
	 * end of the list pulls in the next page as it scrolls into view, so a vault
	 * of hundreds of submissions keeps a small DOM (PRD §7).
	 */
	const PAGE = 80;
	let rendered = $state(PAGE);

	const filtered = $derived(sortSubmissions(applyFilter(vault.list, ui.filter)));
	const stats = $derived(computeStats(filtered));
	const visible = $derived(filtered.slice(0, rendered));

	/** The competition picked in the header's "into" field, if any. */
	const active = $derived(vault.competitions.find((c) => c.slug === ui.filter.competition) ?? null);
	const activeEmpty = $derived(
		active !== null && !vault.list.some((s) => s.competition.slug === active.slug)
	);

	// Any filter change resets the window to the top.
	$effect(() => {
		void ui.filter;
		rendered = PAGE;
	});

	function sentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(records) => {
				if (records.some((r) => r.isIntersecting) && rendered < filtered.length) {
					rendered = Math.min(filtered.length, rendered + PAGE);
				}
			},
			{ rootMargin: '600px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	function focusCard(index: number) {
		ui.cursor = index;
		document
			.querySelector(`[data-card="${index}"]`)
			?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
	}

	function onkeydown(event: KeyboardEvent) {
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === 'j' || event.key === 'ArrowDown') {
			event.preventDefault();
			if (filtered.length === 0) return;
			const next = Math.min(filtered.length - 1, ui.cursor + 1);
			if (next >= rendered) rendered = Math.min(filtered.length, rendered + PAGE);
			focusCard(next);
		} else if (event.key === 'k' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (filtered.length === 0) return;
			focusCard(Math.max(0, ui.cursor - 1));
		} else if (event.key === 'Enter') {
			const current = filtered[ui.cursor];
			if (current !== undefined) {
				event.preventDefault();
				void goto(`${base}/s/${encodeURIComponent(current.id)}`);
			}
		} else if (event.key === 'Escape') {
			ui.clearFilter();
		}
	}

	function selectCell(scenarioCode: string, model: string) {
		ui.setFilter({ scenarioCode, model, wave: null });
	}
</script>

<svelte:head><title>GSA Vault{vault.count > 0 ? ` · ${vault.count} breaks` : ''}</title></svelte:head>
<svelte:window {onkeydown} />

{#if !vault.ready}
	<p class="muted loading">reading vault…</p>
{:else if vault.count === 0}
	<section class="empty">
		<h1 class="empty__head">DROP SUBMISSIONS<span class="cursor">_</span></h1>
		<p class="empty__sub">
			drag any mix of <span class="red">.json</span> and <span class="red">.zip</span> anywhere on
			this window
		</p>

		<button class="empty__pick" onclick={() => ui.pickFiles()} type="button">
			select files<span class="empty__pick-hint">.json · .zip · multiple</span>
		</button>

		{#if active !== null}
			<p class="empty__sub">filing under <span class="red">{active.name}</span></p>
		{/if}

		<p class="empty__note muted">
			nothing leaves this browser · no backend · no network calls
		</p>
	</section>
{:else if activeEmpty && active !== null}
	<section class="empty">
		<h1 class="empty__head">{active.name}<span class="cursor">_</span></h1>
		<p class="empty__sub">
			nothing filed here yet · drop <span class="red">.json</span> or <span class="red">.zip</span>
			files to file them under this competition, or drag a wave onto it in the sidebar
		</p>

		<button class="empty__pick" onclick={() => ui.pickFiles()} type="button">
			select files<span class="empty__pick-hint">filed under {active.name}</span>
		</button>

		<p class="empty__note muted">
			<button class="ghost" onclick={() => ui.setActiveCompetition(null)} type="button">
				show all competitions
			</button>
		</p>
	</section>
{:else}
	<section class="dash">
		<h1 class="sr-only">Dashboard</h1>
		<StatStrip {stats} />

		<div class="charts">
			<div class="panel chart-panel">
				<div class="panel__head"><span class="label label--red">[ BREAKS PER MODEL ]</span></div>
				<div class="panel__body"><Bar items={stats.perModel} id="ui-model" maxRows={12} /></div>
			</div>

			<div class="panel chart-panel">
				<div class="panel__head"><span class="label label--red">[ BREAKS PER SCENARIO ]</span></div>
				<div class="panel__body">
					<Bar items={stats.perScenario} id="ui-scenario" maxRows={12} labelChars={12} />
				</div>
			</div>

			<div class="panel chart-panel chart-panel--wide">
				<div class="panel__head">
					<span class="label label--red">[ TIMELINE ]</span>
					{#if stats.dateRange !== null}
						<span class="muted range">
							{formatDate(stats.dateRange.from)} → {formatDate(stats.dateRange.to)}
						</span>
					{/if}
				</div>
				<div class="panel__body"><Timeline points={stats.timeline} id="ui-time" /></div>
			</div>

			<div class="panel chart-panel chart-panel--wide">
				<div class="panel__head">
					<span class="label label--red">[ SCENARIO × MODEL ]</span>
					<span class="muted range">click a cell to filter</span>
				</div>
				<div class="panel__body">
					<Heatmap matrix={stats.matrix} id="ui-heat" onselect={selectCell} />
				</div>
			</div>
		</div>
	</section>

	<section class="list">
		<div class="list__head">
			<FilterChips tree={vault.tree} shown={filtered.length} total={vault.count} />
		</div>

		{#if filtered.length === 0}
			<p class="muted no-match">no submissions match this filter</p>
		{:else}
			<div class="cards">
				{#each visible as submission, i (submission.id)}
					<div data-card={i}>
						<SubmissionCard {submission} active={i === ui.cursor} />
					</div>
				{/each}
			</div>

			{#if rendered < filtered.length}
				<div class="more" use:sentinel>
					<span class="muted">{filtered.length - rendered} more…</span>
				</div>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.loading {
		padding: var(--gap-5);
		font-size: var(--fs-sm);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.empty {
		display: grid;
		place-content: center;
		justify-items: center;
		text-align: center;
		min-height: calc(100vh - var(--header-h) - var(--gap-6));
		border: 1px dashed var(--line);
		padding: var(--gap-6);
	}

	.empty__head {
		font-size: clamp(28px, 7vw, 64px);
		letter-spacing: var(--track);
	}

	.empty__sub {
		margin: var(--gap-4) 0 0;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-sm);
	}

	/* Primary action on an otherwise bare screen, so it gets real weight. */
	.empty__pick {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--gap-2);
		margin-top: var(--gap-5);
		padding: var(--gap-4) var(--gap-6);
		border: 1px solid var(--red);
		background: linear-gradient(180deg, rgba(225, 6, 0, 0.16) 0%, rgba(20, 20, 20, 0.9) 100%);
		font-size: var(--fs-md);
		font-weight: 700;
	}

	.empty__pick:hover:not(:disabled) {
		background: var(--grad-red);
		color: var(--text);
	}

	.empty__pick-hint {
		font-size: var(--fs-xs);
		font-weight: 400;
		color: var(--muted);
	}

	.empty__pick:hover .empty__pick-hint {
		color: var(--text);
	}

	.empty__note {
		margin: var(--gap-5) 0 0;
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: var(--gap-4);
		margin-top: var(--gap-4);
	}

	.chart-panel--wide {
		grid-column: 1 / -1;
	}

	.chart-panel .panel__body {
		overflow: hidden;
	}

	.range {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.list {
		margin-top: var(--gap-5);
	}

	.list__head {
		position: sticky;
		top: var(--header-h);
		z-index: 40;
		padding: var(--gap-3) 0;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: var(--gap-3);
		margin-top: var(--gap-3);
	}

	.no-match {
		padding: var(--gap-5) 0;
		font-size: var(--fs-sm);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.more {
		padding: var(--gap-5);
		text-align: center;
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}
</style>
