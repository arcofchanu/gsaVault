<script lang="ts">
	import { base } from '$app/paths';
	import HighlightedText from '$lib/components/HighlightedText.svelte';
	import { vault } from '$lib/store/vault.svelte';
	import { countPlaceholders, formatDate, shortId } from '$lib/util/text';
	import type { Submission } from '$lib/types';

	let { submission, active = false }: { submission: Submission; active?: boolean } = $props();

	const filled = $derived(submission.payloadSlots.filter((s) => !s.empty));

	/** First line of injection prose, or the raw slot, as a one-glance preview. */
	const preview = $derived.by(() => {
		for (const slot of filled) {
			const prose = slot.prose[0];
			if (prose !== undefined) return prose.text;
		}
		return filled[0]?.raw ?? '';
	});

	const placeholders = $derived(
		countPlaceholders(submission.payloadSlots.map((s) => s.raw).join('\n'))
	);

	function flipMode(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		void vault.setMode(submission.id, submission.mode === 'single' ? 'multi' : 'single');
	}

	function applyHint(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (submission.modeHint !== null) void vault.setMode(submission.id, submission.modeHint);
	}
</script>

<article class="card hoverable" class:is-active={active}>
	<a class="card__link" href="{base}/s/{encodeURIComponent(submission.id)}">
		<span class="sr-only">Open {submission.scenario.full}</span>
	</a>

	<header class="card__head">
		<h3 class="title">
			<span class="code">{submission.scenario.code}</span>
			<span class="label-text">{submission.scenario.label}</span>
		</h3>
		<span class="model">{submission.model}</span>
	</header>

	<div class="meta">
		<span>{submission.competition.name}</span>
		<span>wave <span class="red">{submission.wave}</span></span>
		<span>{formatDate(submission.createdAt)}</span>
		<span>{shortId(submission.id)}</span>
		<span>{filled.length}/{submission.payloadSlots.length} slots</span>
		{#if placeholders > 0}
			<span>{placeholders} placeholders</span>
		{/if}
	</div>

	<div class="controls">
		<button
			class="tag tag--button"
			class:tag--red={submission.mode === 'multi'}
			onclick={flipMode}
			type="button"
			title="Click to switch mode"
		>
			{submission.mode}-turn
		</button>
		{#if submission.modeHint !== null && submission.modeHint !== submission.mode}
			<button class="hint" onclick={applyHint} type="button">
				looks {submission.modeHint}-turn — switch
			</button>
		{/if}
	</div>

	{#if submission.initialTask.trim() !== ''}
		<p class="task"><span class="label">// initial task</span>{submission.initialTask}</p>
	{/if}

	{#if preview.trim() !== ''}
		<p class="preview"><span class="label label--red">// payload</span><HighlightedText text={preview} /></p>
	{/if}
</article>

<style>
	.card {
		position: relative;
		border: 1px solid var(--line);
		border-left: 2px solid var(--line);
		background: var(--grad-surface);
		padding: var(--gap-3) var(--gap-4);
	}

	.card.is-active {
		border-color: var(--red);
		border-left-color: var(--red);
	}

	.card:hover {
		border-left-color: var(--red);
	}

	/* Stretched link: the whole card is the hit target, controls sit above it. */
	.card__link {
		position: absolute;
		inset: 0;
		z-index: 0;
	}

	.card__head,
	.meta,
	.controls,
	.task,
	.preview {
		position: relative;
		z-index: 1;
		pointer-events: none;
	}

	.controls {
		pointer-events: auto;
	}

	.card__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--gap-3);
		flex-wrap: wrap;
	}

	.title {
		display: flex;
		align-items: baseline;
		gap: var(--gap-2);
		flex-wrap: wrap;
		min-width: 0;
		text-transform: none;
		letter-spacing: 0;
		font-size: var(--fs-md);
	}

	.code {
		color: var(--red);
		letter-spacing: var(--track);
	}

	.label-text {
		color: var(--text);
	}

	.model {
		color: var(--muted);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}

	.meta {
		margin-top: var(--gap-2);
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap-1) var(--gap-3);
		color: var(--muted);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.controls {
		margin-top: var(--gap-2);
		display: flex;
		align-items: center;
		gap: var(--gap-2);
	}

	.tag--button {
		cursor: pointer;
		background: transparent;
		padding: 1px var(--gap-2);
		font-size: var(--fs-xs);
	}
	.tag--button:hover {
		border-color: var(--red);
		color: var(--red);
	}

	.hint {
		padding: 1px var(--gap-2);
		font-size: var(--fs-xs);
		border-color: var(--red-dim);
		color: var(--red);
		background: transparent;
		text-transform: none;
		letter-spacing: 0;
	}

	.task,
	.preview {
		margin: var(--gap-3) 0 0;
		font-size: var(--fs-sm);
		line-height: 1.55;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.task {
		color: var(--muted);
	}

	.task .label,
	.preview .label {
		display: inline;
		margin-right: var(--gap-2);
	}
</style>
