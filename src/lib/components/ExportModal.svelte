<script lang="ts" module>
	export interface ExportChoice {
		key: string;
		label: string;
		/** Small print under the label, e.g. "current view". */
		hint: string;
		count: number;
	}
</script>

<script lang="ts">
	let {
		kind,
		choices,
		initial,
		onconfirm,
		onclose
	}: {
		kind: 'pdf' | 'json';
		choices: ExportChoice[];
		initial: string;
		onconfirm: (key: string) => void;
		onclose: () => void;
	} = $props();

	let picked = $state('');
	// Seed from the prop once the modal opens.
	$effect(() => {
		picked = initial;
	});

	const chosen = $derived(choices.find((c) => c.key === picked));

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
	}

	function confirm() {
		if (chosen !== undefined && chosen.count > 0) onconfirm(chosen.key);
	}
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<div
	class="modal panel"
	role="dialog"
	aria-modal="true"
	aria-label="Export {kind}"
	tabindex="-1"
	onkeydown={keydown}
>
	<div class="panel__head">
		<h2>Export {kind.toUpperCase()}</h2>
		<button class="ghost" onclick={onclose} type="button" title="Close">×</button>
	</div>

	<div class="panel__body">
		<p class="label">// which competition?</p>

		<div class="choices" role="radiogroup" aria-label="What to export">
			{#each choices as choice (choice.key)}
				<label class="choice" class:is-picked={picked === choice.key} class:is-empty={choice.count === 0}>
					<input
						type="radio"
						name="export-scope"
						value={choice.key}
						bind:group={picked}
						disabled={choice.count === 0}
					/>
					<span class="choice__text">
						<span class="choice__label">{choice.label}</span>
						<span class="choice__hint">{choice.hint}</span>
					</span>
					<span class="choice__count">{choice.count}</span>
				</label>
			{/each}
		</div>

		<div class="actions">
			<span class="muted summary">
				{#if chosen !== undefined}{chosen.count} submission{chosen.count === 1 ? '' : 's'}{/if}
			</span>
			<span class="spacer"></span>
			<button class="ghost" onclick={onclose} type="button">cancel</button>
			<button onclick={confirm} disabled={chosen === undefined || chosen.count === 0} type="button">
				export {kind}
			</button>
		</div>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 95;
		background: rgba(10, 10, 10, 0.82);
	}

	.modal {
		position: fixed;
		z-index: 96;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(520px, calc(100vw - var(--gap-5)));
		max-height: calc(100vh - var(--gap-6));
		overflow: auto;
		border-color: var(--red);
	}

	.choices {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
	}

	.choice {
		display: flex;
		align-items: center;
		gap: var(--gap-3);
		padding: var(--gap-3);
		cursor: pointer;
		border-left: 2px solid transparent;
	}

	.choice + .choice {
		border-top: 1px solid var(--line);
	}

	.choice:hover {
		color: var(--red);
	}

	.choice.is-picked {
		border-left-color: var(--red);
		background: linear-gradient(90deg, rgba(225, 6, 0, 0.12) 0%, transparent 70%);
	}

	.choice.is-empty {
		cursor: default;
		color: var(--muted);
	}

	.choice input {
		accent-color: var(--red);
		margin: 0;
	}

	.choice__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.choice__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-transform: uppercase;
		letter-spacing: var(--track);
		font-size: var(--fs-sm);
	}

	.choice__hint {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.choice__count {
		flex: none;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-xs);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--gap-2);
		margin-top: var(--gap-4);
		padding-top: var(--gap-3);
		border-top: 1px solid var(--line);
	}

	.summary {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.spacer {
		flex: 1;
	}
</style>
