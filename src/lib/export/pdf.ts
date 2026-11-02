/**
 * Public entry point for PDF export. Prefers the Web Worker; falls back to the
 * main thread if a worker cannot be created or dies, so the feature never
 * disappears on a browser that restricts workers.
 */
import PdfWorker from '$lib/export/pdf.worker?worker&inline';
import type { PdfInput } from '$lib/export/pdfDoc';
import type { PdfWorkerResponse } from '$lib/export/pdf.worker';
import type { Submission } from '$lib/types';

export { pdfFilename } from '$lib/export/pdfDoc';
export type { PdfInput } from '$lib/export/pdfDoc';

export type ProgressFn = (percent: number) => void;

/**
 * Rebuild the input as plain, structured-cloneable data.
 *
 * Two reasons this is not optional:
 *
 * 1. Submissions come out of a Svelte `$state` store, so they are Proxy
 *    objects. `postMessage` refuses to clone a Proxy (`DataCloneError`), and
 *    the failure only shows up at runtime.
 * 2. It drops what the report never reads — the verbatim `raw` export and the
 *    tool-call bodies — which is the bulk of a submission's weight. The PDF
 *    prints only `[n tool calls]`, so only the count has to cross.
 */
function toTransferable(input: PdfInput): PdfInput {
	const submissions: Submission[] = input.submissions.map((s) => ({
		id: s.id,
		competition: { slug: s.competition.slug, name: s.competition.name },
		competitionAssigned: s.competitionAssigned,
		wave: s.wave,
		scenario: { full: s.scenario.full, code: s.scenario.code, label: s.scenario.label },
		model: s.model,
		mode: s.mode,
		modeHint: s.modeHint,
		createdAt: s.createdAt,
		exportedAt: s.exportedAt,
		initialTask: s.initialTask,
		payloadSlots: s.payloadSlots.map((slot) => ({
			index: slot.index,
			raw: slot.raw,
			empty: slot.empty,
			// Arbitrary nested JSON from the store, so proxies all the way down.
			parsed: slot.parsed === null ? null : (JSON.parse(JSON.stringify(slot.parsed)) as unknown),
			prose: slot.prose.map((p) => ({ field: p.field, text: p.text }))
		})),
		payloadSource: s.payloadSource,
		transcript: s.transcript.map((m) => ({
			role: m.role,
			content: m.content,
			timestamp: m.timestamp,
			// Count-preserving placeholders: the report prints the count only.
			toolCalls: m.toolCalls.map(() => ({ name: '', arguments: null, output: null }))
		})),
		sourceFile: s.sourceFile,
		importedAt: s.importedAt,
		raw: null
	}));
	return {
		submissions,
		scopeLabel: input.scopeLabel,
		exportedAt: input.exportedAt,
		// Plain copy: the profile also comes out of the reactive store.
		...(input.profile === undefined ? {} : { profile: { ...input.profile } })
	};
}

function renderInWorker(input: PdfInput, onProgress?: ProgressFn): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		let worker: Worker;
		try {
			worker = new PdfWorker();
		} catch (err) {
			reject(err instanceof Error ? err : new Error(String(err)));
			return;
		}

		const finish = (fn: () => void) => {
			worker.terminate();
			fn();
		};

		worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
			const message = event.data;
			if (message.type === 'progress') onProgress?.(message.percent);
			else if (message.type === 'done') finish(() => resolve(new Uint8Array(message.bytes)));
			else finish(() => reject(new Error(message.message)));
		};
		worker.onerror = (event) => finish(() => reject(new Error(event.message || 'PDF worker failed')));

		worker.postMessage({ input } satisfies { input: PdfInput });
	});
}

async function renderOnMainThread(input: PdfInput, onProgress?: ProgressFn): Promise<Uint8Array> {
	const [{ default: pdfMake }, { renderPdf }, { browserFonts }] = await Promise.all([
		import('pdfmake'),
		import('$lib/export/pdfRender'),
		import('$lib/export/fontsBrowser')
	]);
	return renderPdf(
		pdfMake as unknown as Parameters<typeof renderPdf>[0],
		input,
		onProgress,
		browserFonts()
	);
}

/** Build the report. Progress is reported 0–100. */
export async function generatePdf(input: PdfInput, onProgress?: ProgressFn): Promise<Blob> {
	const payload = toTransferable(input);
	let bytes: Uint8Array;
	try {
		bytes = await renderInWorker(payload, onProgress);
	} catch (workerError) {
		// A real document problem will fail the same way on the main thread and
		// surface there; this only rescues worker-environment failures.
		console.warn('PDF worker unavailable, rendering on the main thread:', workerError);
		bytes = await renderOnMainThread(payload, onProgress);
	}
	return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
