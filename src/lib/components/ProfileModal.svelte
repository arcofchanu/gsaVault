<script lang="ts">
	import { EMPTY_PROFILE, normalizePhoto, type Profile } from '$lib/profile';

	let { profile, onsave, onclose }: {
		profile: Profile;
		onsave: (profile: Profile) => void | Promise<void>;
		onclose: () => void;
	} = $props();

	// Edited on a copy, so cancelling leaves the stored profile untouched.
	let draft = $state<Profile>({ ...EMPTY_PROFILE });
	// Seed from the prop once the modal opens.
	$effect(() => {
		draft = { ...profile };
	});
	let photoError = $state<string | null>(null);
	let photoInput: HTMLInputElement | undefined = $state();
	let first: HTMLInputElement | undefined = $state();

	$effect(() => {
		first?.focus();
	});

	async function pickPhoto(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file === undefined) return;
		photoError = null;
		try {
			draft = { ...draft, photo: await normalizePhoto(file) };
		} catch (err) {
			photoError = (err as Error).message;
		}
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
	}
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<div
	class="modal panel"
	role="dialog"
	aria-modal="true"
	aria-label="GSA profile"
	tabindex="-1"
	onkeydown={keydown}
>
	<div class="panel__head">
		<h2>GSA Profile</h2>
		<button class="ghost" onclick={onclose} type="button" title="Close">×</button>
	</div>

	<div class="panel__body">
		<p class="label">// printed on the pdf cover · typed by hand, nothing is fetched</p>

		<div class="photo-row">
			<div class="photo" class:photo--empty={draft.photo === null}>
				{#if draft.photo !== null}
					<img src={draft.photo} alt="" />
				{:else}
					<span class="photo__hint">no photo</span>
				{/if}
			</div>
			<div class="photo-actions">
				<button onclick={() => photoInput?.click()} type="button">
					{draft.photo === null ? 'add photo' : 'replace photo'}
				</button>
				{#if draft.photo !== null}
					<button class="ghost" onclick={() => (draft = { ...draft, photo: null })} type="button">
						remove
					</button>
				{/if}
				<p class="muted note">
					cropped square and re-encoded as a small png, so it embeds in the pdf
				</p>
				{#if photoError !== null}
					<p class="error">{photoError}</p>
				{/if}
			</div>
		</div>

		<input
			bind:this={photoInput}
			class="sr-only"
			type="file"
			accept="image/*"
			onchange={pickPhoto}
			tabindex="-1"
		/>

		<div class="fields">
			<label class="field">
				<span class="label">name</span>
				<input bind:this={first} type="text" bind:value={draft.name} spellcheck="false" />
			</label>
			<label class="field">
				<span class="label">global rank</span>
				<input type="text" bind:value={draft.rank} placeholder="#12" spellcheck="false" />
			</label>
			<label class="field">
				<span class="label">unique behaviours broken</span>
				<input type="text" bind:value={draft.uniqueBreaks} placeholder="47" spellcheck="false" />
			</label>
			<label class="field">
				<span class="label">total money won</span>
				<input type="text" bind:value={draft.earnings} placeholder="$12,400" spellcheck="false" />
			</label>
			<label class="field field--wide">
				<span class="label">public profile url</span>
				<input
					type="text"
					bind:value={draft.profileUrl}
					placeholder="https://app.grayswan.ai/arena/user/…"
					spellcheck="false"
				/>
			</label>
		</div>

		<div class="actions">
			<button class="ghost" onclick={() => (draft = { ...EMPTY_PROFILE })} type="button">
				clear all
			</button>
			<span class="spacer"></span>
			<button class="ghost" onclick={onclose} type="button">cancel</button>
			<button onclick={() => onsave(draft)} type="button">save</button>
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
		width: min(680px, calc(100vw - var(--gap-5)));
		max-height: calc(100vh - var(--gap-6));
		overflow: auto;
		border-color: var(--red);
	}

	.photo-row {
		display: flex;
		gap: var(--gap-4);
		align-items: flex-start;
		margin-bottom: var(--gap-4);
		padding-bottom: var(--gap-4);
		border-bottom: 1px solid var(--line);
	}

	.photo {
		flex: none;
		width: 84px;
		height: 84px;
		border: 1px solid var(--line);
		background: var(--bg);
		display: grid;
		place-items: center;
		overflow: hidden;
	}

	.photo--empty {
		border-style: dashed;
	}

	.photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.photo__hint {
		color: var(--muted);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.photo-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--gap-2);
	}

	.note {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--fs-xs);
	}

	.error {
		flex-basis: 100%;
		margin: 0;
		color: var(--red);
		font-size: var(--fs-xs);
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--gap-3);
	}

	.field--wide {
		grid-column: 1 / -1;
	}

	.field .label {
		margin-bottom: var(--gap-1);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--gap-2);
		margin-top: var(--gap-4);
		padding-top: var(--gap-3);
		border-top: 1px solid var(--line);
	}

	.spacer {
		flex: 1;
	}
</style>
