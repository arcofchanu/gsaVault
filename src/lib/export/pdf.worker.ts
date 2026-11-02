/**
 * Renders the report off the main thread so a large vault does not freeze the
 * UI (PRD §7). Inlined into the bundle by Vite (`?worker&inline`), so starting
 * it costs no network request.
 */
import pdfMake from 'pdfmake';
import { browserFonts } from '$lib/export/fontsBrowser';
import { renderPdf, type PdfMakeLike } from '$lib/export/pdfRender';
import type { PdfInput } from '$lib/export/pdfDoc';

export interface PdfWorkerRequest {
	input: PdfInput;
}

export type PdfWorkerResponse =
	| { type: 'progress'; percent: number }
	| { type: 'done'; bytes: ArrayBuffer }
	| { type: 'error'; message: string };

const engine = pdfMake as unknown as PdfMakeLike;

function post(message: PdfWorkerResponse, transfer: Transferable[] = []): void {
	(self as unknown as Worker).postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
	try {
		const bytes = await renderPdf(
			engine,
			event.data.input,
			(percent) => post({ type: 'progress', percent }),
			browserFonts()
		);
		// Copy out of the (possibly pooled) backing store before transferring.
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength
		) as ArrayBuffer;
		post({ type: 'done', bytes: buffer }, [buffer]);
	} catch (err) {
		post({ type: 'error', message: (err as Error).message });
	}
};
