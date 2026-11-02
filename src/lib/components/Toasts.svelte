<script lang="ts">
	import { ui } from '$lib/store/ui.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each ui.toasts as toast (toast.id)}
		<div class="toast" class:warn={toast.kind === 'warn'}>
			<div class="row">
				<span class="text">{toast.text}</span>
				{#if toast.failures.length > 0}
					<button class="ghost" onclick={() => ui.toggleToast(toast.id)} type="button">
						{toast.expanded ? 'hide' : 'why'}
					</button>
				{/if}
				<button class="ghost" onclick={() => ui.dismiss(toast.id)} type="button" title="Dismiss">
					×
				</button>
			</div>
			{#if toast.expanded}
				<ul class="failures">
					{#each toast.failures as failure (failure.path)}
						<li><span class="path">{failure.path}</span><span class="muted">{failure.reason}</span></li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		right: var(--gap-4);
		bottom: var(--gap-4);
		z-index: 80;
		display: flex;
		flex-direction: column;
		gap: var(--gap-2);
		max-width: min(520px, calc(100vw - var(--gap-5)));
	}

	.toast {
		border: 1px solid var(--line);
		border-left: 2px solid var(--red);
		background: var(--grad-surface);
		padding: var(--gap-2) var(--gap-3);
	}

	.toast.warn {
		border-left-color: var(--red);
		background: linear-gradient(90deg, var(--red-dim) 0%, var(--surface) 55%);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--gap-3);
	}

	.text {
		flex: 1;
		font-size: var(--fs-sm);
	}

	.failures {
		margin: var(--gap-2) 0 0;
		padding: var(--gap-2) 0 0;
		border-top: 1px solid var(--line);
		list-style: none;
		max-height: 220px;
		overflow-y: auto;
		font-size: var(--fs-xs);
	}

	.failures li {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
		padding: 2px 0;
	}

	.path {
		color: var(--text);
	}
</style>
