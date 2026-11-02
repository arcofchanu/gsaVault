<script lang="ts">
	let {
		onsubmit,
		onclose
	}: { onsubmit: (text: string) => void | Promise<void>; onclose: () => void } = $props();

	let text = $state('');
	let area: HTMLTextAreaElement | undefined = $state();

	$effect(() => {
		area?.focus();
	});

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
		// Ctrl/Cmd+Enter submits, so a multi-line paste is not cut short by Enter.
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim() !== '') {
			void onsubmit(text);
		}
	}
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<div
	class="modal panel"
	role="dialog"
	aria-modal="true"
	aria-label="Paste JSON"
	tabindex="-1"
	onkeydown={keydown}
>
	<div class="panel__head">
		<h2>Paste JSON</h2>
		<button class="ghost" onclick={onclose} type="button" title="Close">×</button>
	</div>
	<div class="panel__body">
		<p class="label">// a single GSA export, or a gsa-vault/1 bundle</p>
		<textarea
			bind:this={area}
			bind:value={text}
			rows="14"
			spellcheck="false"
			placeholder={'{ "schema": "gsa-vault/1", ... }'}
		></textarea>
		<div class="actions">
			<span class="muted hint">{text.length.toLocaleString()} chars · ⌘/ctrl+enter</span>
			<button onclick={() => onsubmit(text)} disabled={text.trim() === ''} type="button">
				Import
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
		width: min(760px, calc(100vw - var(--gap-5)));
		max-height: calc(100vh - var(--gap-6));
		overflow: auto;
		border-color: var(--red);
	}

	textarea {
		font-size: var(--fs-base);
		resize: vertical;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap-3);
		margin-top: var(--gap-3);
	}

	.hint {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}
</style>
