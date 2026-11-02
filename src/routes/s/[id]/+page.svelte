<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import HighlightedText from '$lib/components/HighlightedText.svelte';
	import PayloadSlots from '$lib/components/PayloadSlots.svelte';
	import Transcript from '$lib/components/Transcript.svelte';
	import { deriveWave } from '$lib/parse/arenaChat';
	import { applyFilter, sortSubmissions } from '$lib/stats';
	import { ui } from '$lib/store/ui.svelte';
	import { vault } from '$lib/store/vault.svelte';
	import { formatDateTime } from '$lib/util/text';

	const id = $derived(decodeURIComponent(page.params.id ?? ''));
	const submission = $derived(vault.submissions[id]);

	/** Neighbours within the current filter, so prev/next walks the same list. */
	const siblings = $derived(sortSubmissions(applyFilter(vault.list, ui.filter)));
	const position = $derived(siblings.findIndex((s) => s.id === id));
	const prev = $derived(position > 0 ? siblings[position - 1] : undefined);
	const next = $derived(position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : undefined);

	const derivedWave = $derived(submission ? deriveWave(submission.scenario.code) : '—');
	const overridden = $derived(submission !== undefined && submission.wave !== derivedWave);

	let waveDraft = $state('');
	let editingWave = $state(false);

	function startWaveEdit() {
		if (submission === undefined) return;
		waveDraft = submission.wave;
		editingWave = true;
	}

	async function saveWave() {
		if (submission === undefined) return;
		editingWave = false;
		await vault.setWave(submission.competition.slug, submission.scenario.code, waveDraft);
	}

	async function resetWave() {
		if (submission === undefined) return;
		editingWave = false;
		await vault.setWave(submission.competition.slug, submission.scenario.code, null);
	}

	function flipMode() {
		if (submission === undefined) return;
		void vault.setMode(submission.id, submission.mode === 'single' ? 'multi' : 'single');
	}

	function back() {
		void goto(`${base}/`);
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

		if (event.key === 'Escape') {
			event.preventDefault();
			back();
		} else if ((event.key === 'j' || event.key === 'ArrowDown') && next !== undefined) {
			event.preventDefault();
			void goto(`${base}/s/${encodeURIComponent(next.id)}`);
		} else if ((event.key === 'k' || event.key === 'ArrowUp') && prev !== undefined) {
			event.preventDefault();
			void goto(`${base}/s/${encodeURIComponent(prev.id)}`);
		}
	}
</script>

<svelte:head>
	<title>{submission ? `${submission.scenario.code} · ${submission.model}` : 'Not found'} · GSA Vault</title>
</svelte:head>
<svelte:window {onkeydown} />

{#if !vault.ready}
	<p class="muted status">reading vault…</p>
{:else if submission === undefined}
	<section class="panel">
		<div class="panel__body">
			<h1>Not in this vault</h1>
			<p class="muted">
				No submission with id <span class="red">{id}</span>. It may have been cleared, or this link
				came from another vault.
			</p>
			<button onclick={back} type="button">back to list</button>
		</div>
	</section>
{:else}
	<nav class="crumbs">
		<button class="ghost" onclick={back} type="button">← list <span class="key">esc</span></button>
		<div class="spacer"></div>
		{#if position >= 0}
			<span class="muted pos">{position + 1} / {siblings.length}</span>
		{/if}
		<a class="step" class:is-off={prev === undefined} href={prev ? `${base}/s/${encodeURIComponent(prev.id)}` : '#'}>
			prev <span class="key">k</span>
		</a>
		<a class="step" class:is-off={next === undefined} href={next ? `${base}/s/${encodeURIComponent(next.id)}` : '#'}>
			next <span class="key">j</span>
		</a>
	</nav>

	<header class="head panel">
		<div class="panel__body">
			<p class="comp">{submission.competition.name} <span class="muted">· {submission.competition.slug}</span></p>
			<h1 class="title">
				<span class="code">{submission.scenario.code}</span>
				<span>{submission.scenario.label}</span>
			</h1>

			<dl class="facts">
				<div class="fact">
					<dt>model</dt>
					<dd>{submission.model}</dd>
				</div>
				<div class="fact">
					<dt>wave</dt>
					<dd>
						{#if editingWave}
							<span class="wave-edit">
								<input
									type="text"
									bind:value={waveDraft}
									onkeydown={(e) => {
										if (e.key === 'Enter') void saveWave();
										if (e.key === 'Escape') editingWave = false;
									}}
									size="6"
									aria-label="Wave"
								/>
								<button class="ghost" onclick={saveWave} type="button">save</button>
								<button class="ghost" onclick={resetWave} type="button" title="Restore the wave derived from the scenario code">reset</button>
							</span>
						{:else}
							<button class="wave" onclick={startWaveEdit} type="button" title="Override the wave for this scenario code">
								<span class="red">{submission.wave}</span>
								{#if overridden}<span class="tag">set</span>{/if}
							</button>
						{/if}
					</dd>
				</div>
				<div class="fact">
					<dt>mode</dt>
					<dd>
						<button class="tag tag--button" class:tag--red={submission.mode === 'multi'} onclick={flipMode} type="button">
							{submission.mode}-turn
						</button>
						{#if submission.modeHint !== null && submission.modeHint !== submission.mode}
							<span class="muted hint">looks {submission.modeHint}-turn</span>
						{/if}
					</dd>
				</div>
				<div class="fact">
					<dt>created</dt>
					<dd>{formatDateTime(submission.createdAt)}</dd>
				</div>
				<div class="fact">
					<dt>exported</dt>
					<dd>{formatDateTime(submission.exportedAt)}</dd>
				</div>
				<div class="fact">
					<dt>chat id</dt>
					<dd>{submission.id}</dd>
				</div>
				<div class="fact fact--wide">
					<dt>source</dt>
					<dd class="src">{submission.sourceFile}</dd>
				</div>
			</dl>

			{#if editingWave}
				<p class="muted note">
					// the wave applies to every <span class="red">{submission.scenario.code}</span>
					submission in this competition, and travels in the JSON bundle
				</p>
			{/if}
		</div>
	</header>

	{#if submission.mode === 'single'}
		<section class="panel">
			<div class="panel__head">
				<span class="label label--red">[ INITIAL TASK ]</span>
				<CopyButton text={submission.initialTask} />
			</div>
			<div class="panel__body">
				{#if submission.initialTask.trim() === ''}
					<p class="muted">—</p>
				{:else}
					<div class="block task"><HighlightedText text={submission.initialTask} /></div>
				{/if}
			</div>
		</section>

		<section class="panel">
			<div class="panel__body">
				<PayloadSlots slots={submission.payloadSlots} source={submission.payloadSource} />
			</div>
		</section>
	{:else}
		<section class="panel">
			<div class="panel__body">
				<Transcript transcript={submission.transcript} />
			</div>
		</section>
	{/if}
{/if}

<style>
	.status {
		padding: var(--gap-5);
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-sm);
	}

	.crumbs {
		display: flex;
		align-items: center;
		gap: var(--gap-3);
		margin-bottom: var(--gap-4);
	}

	.spacer {
		flex: 1;
	}

	.pos {
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}

	.step {
		border: 1px solid var(--line);
		padding: var(--gap-2) var(--gap-3);
		font-size: var(--fs-sm);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}
	.step:hover {
		border-color: var(--red);
	}
	.step.is-off {
		color: var(--muted);
		pointer-events: none;
		opacity: 0.5;
	}

	.key {
		border: 1px solid var(--line);
		padding: 0 3px;
		color: var(--muted);
		font-size: var(--fs-xs);
		margin-left: var(--gap-1);
	}

	.head {
		border-left: 2px solid var(--red);
	}

	.comp {
		margin: 0;
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
		color: var(--muted);
	}

	.title {
		margin: var(--gap-2) 0 var(--gap-4);
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap-3);
		align-items: baseline;
		font-size: var(--fs-xl);
		text-transform: none;
	}

	.title .code {
		color: var(--red);
		letter-spacing: var(--track);
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--gap-3);
		margin: 0;
		border-top: 1px solid var(--line);
		padding-top: var(--gap-3);
	}

	.fact--wide {
		grid-column: 1 / -1;
	}

	dt {
		color: var(--muted);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	dd {
		margin: var(--gap-1) 0 0;
		display: flex;
		align-items: center;
		gap: var(--gap-2);
		flex-wrap: wrap;
		font-size: var(--fs-sm);
	}

	.src {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.wave,
	.tag--button {
		background: transparent;
		border: 1px solid var(--line);
		padding: 1px var(--gap-2);
		font-size: var(--fs-xs);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: var(--gap-2);
	}
	.wave:hover,
	.tag--button:hover {
		border-color: var(--red);
	}

	.wave-edit {
		display: inline-flex;
		align-items: center;
		gap: var(--gap-2);
	}

	.wave-edit input {
		width: 80px;
		padding: 2px var(--gap-2);
	}

	.hint {
		font-size: var(--fs-xs);
	}

	.note {
		margin: var(--gap-3) 0 0;
		font-size: var(--fs-xs);
	}

	.task {
		line-height: 1.6;
	}
</style>
