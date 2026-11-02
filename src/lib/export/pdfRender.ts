/**
 * Drives pdfmake over the document definition. Kept free of any pdfmake import
 * so the same code runs against the browser bundle (in the worker) and the Node
 * build (in the test suite).
 */
import { FONT_VFS, PDF_FONTS } from '$lib/export/fonts.generated';
import {
	buildDocPlan,
	buildPageIndex,
	EMPTY_PAGE_INDEX,
	type NodeObservation,
	type PageIndex,
	type PdfInput
} from '$lib/export/pdfDoc';

interface PdfDocumentLike {
	getBuffer(): Promise<Uint8Array>;
}

export interface PdfMakeLike {
	setFonts(fonts: unknown): void;
	setProgressCallback(callback: (ratio: number) => void): void;
	createPdf(definition: unknown, options?: unknown): PdfDocumentLike;
	/** Browser bundle only. */
	addVirtualFileSystem?(vfs: Record<string, string>): void;
	/** Browser bundle only: registers standard-PDF-font metrics. */
	addFontContainer?(container: { standardFonts?: unknown[] }): void;
	/** Node build exposes the virtual filesystem directly. */
	virtualfs?: { writeFileSync(name: string, content: string, encoding: string): void };
	setUrlAccessPolicy?(callback: (url: string) => boolean): void;
	setLocalAccessPolicy?(callback: (path: string) => boolean): void;
}

/**
 * Where the fonts come from: a base64 VFS to register, plus the pdfmake
 * descriptor that names faces out of it. pdfmake 0.3 insists on string font
 * sources, so the bytes have to arrive through the virtual filesystem rather
 * than being handed over directly.
 */
export interface FontSource {
	vfs?: Record<string, string>;
	fonts: unknown;
	/**
	 * Metrics for standard PDF fonts to register. Only the browser bundle needs
	 * these; the Node build has them compiled in.
	 */
	standardFonts?: unknown[];
}

/** The fonts compiled into the bundle — what the app actually ships. */
export function embeddedFonts(): FontSource {
	return { vfs: FONT_VFS, fonts: PDF_FONTS };
}

const prepared = new WeakSet<PdfMakeLike>();

/** Every font source named by a descriptor, VFS names and standard fonts alike. */
function fontFilePaths(fonts: unknown): Set<string> {
	const out = new Set<string>();
	if (fonts === null || typeof fonts !== 'object') return out;
	for (const family of Object.values(fonts as Record<string, unknown>)) {
		if (family === null || typeof family !== 'object') continue;
		for (const file of Object.values(family as Record<string, unknown>)) {
			if (typeof file === 'string') out.add(file);
		}
	}
	return out;
}

/**
 * Register the fonts and slam the door on any resource fetching: payloads are
 * bounty-confidential, so pdfmake must never resolve a URL or touch the
 * filesystem on our behalf.
 */
export function preparePdfMake(pdfMake: PdfMakeLike, source: FontSource = embeddedFonts()): void {
	if (prepared.has(pdfMake)) return;

	// No URL ever resolves. Local reads are limited to font sources that were
	// given as paths — with the embedded byte arrays that set is empty, so
	// nothing on disk is reachable at all.
	const allowed = fontFilePaths(source.fonts);
	pdfMake.setUrlAccessPolicy?.(() => false);
	pdfMake.setLocalAccessPolicy?.((path) => typeof path === 'string' && allowed.has(path));

	// Standard-font metrics first: the chart SVGs reference Courier, and the
	// browser bundle does not ship its metrics.
	if (source.standardFonts !== undefined && typeof pdfMake.addFontContainer === 'function') {
		pdfMake.addFontContainer({ standardFonts: source.standardFonts });
	}

	if (source.vfs !== undefined) {
		// The browser bundle wraps the VFS; the Node build exposes it raw.
		if (typeof pdfMake.addVirtualFileSystem === 'function') {
			pdfMake.addVirtualFileSystem(source.vfs);
		} else if (pdfMake.virtualfs !== undefined) {
			for (const [name, base64] of Object.entries(source.vfs)) {
				pdfMake.virtualfs.writeFileSync(name, base64, 'base64');
			}
		} else {
			throw new Error('pdfmake build exposes no virtual file system');
		}
	}

	pdfMake.setFonts(source.fonts);
	prepared.add(pdfMake);
}

/** nodeInfo as pdfmake hands it to `pageBreakBefore`. */
interface LayoutNode {
	id?: unknown;
	pageNumbers?: unknown;
	startPosition?: { pageInnerHeight?: unknown; verticalRatio?: unknown };
}

/**
 * Lay the document out once to discover which pages each competition and
 * group occupies.
 *
 * This pass exists because pdfmake renders headers and footers *before* it
 * reports node page numbers to `pageBreakBefore`, so there is no way to label
 * a page from within a single pass. Charts are blanked here — only their
 * dimensions affect pagination, and rasterising them is the most expensive
 * part of the document.
 */
export async function layoutPass(
	pdfMake: PdfMakeLike,
	input: PdfInput,
	onProgress?: (ratio: number) => void,
	fonts: FontSource = embeddedFonts()
): Promise<PageIndex> {
	preparePdfMake(pdfMake, fonts);

	const observations: NodeObservation[] = [];
	const plan = buildDocPlan(input, EMPTY_PAGE_INDEX, { blankCharts: true });
	plan.definition.pageBreakBefore = (node: LayoutNode) => {
		if (typeof node.id === 'string' && Array.isArray(node.pageNumbers)) {
			const pos = node.startPosition;
			const spaceBelow =
				pos !== undefined &&
				typeof pos.pageInnerHeight === 'number' &&
				typeof pos.verticalRatio === 'number'
					? pos.pageInnerHeight * (1 - pos.verticalRatio)
					: undefined;
			observations.push({ id: node.id, pages: node.pageNumbers as number[], spaceBelow });
		}
		return false; // observe only; never force a break
	};

	pdfMake.setProgressCallback((ratio) => onProgress?.(ratio));
	await pdfMake.createPdf(plan.definition).getBuffer();

	return buildPageIndex(observations, plan.competitions, plan.groupLabels);
}

/** Lay out to discover page labels, then render for real. */
export async function renderPdf(
	pdfMake: PdfMakeLike,
	input: PdfInput,
	onProgress?: (percent: number) => void,
	fonts: FontSource = embeddedFonts()
): Promise<Uint8Array> {
	const pageIndex = await layoutPass(
		pdfMake,
		input,
		(ratio) => onProgress?.(Math.round(ratio * 35)),
		fonts
	);

	const finalPass = buildDocPlan(input, pageIndex);
	pdfMake.setProgressCallback((ratio) => onProgress?.(35 + Math.round(ratio * 65)));
	const bytes = await pdfMake.createPdf(finalPass.definition).getBuffer();
	onProgress?.(100);
	return bytes;
}
