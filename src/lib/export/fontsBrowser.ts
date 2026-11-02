/**
 * Browser-side font setup. Kept apart from `pdfRender.ts` so that module stays
 * free of any pdfmake import and can run against either build.
 */
import courierContainer from 'pdfmake/build/standard-fonts/Courier.js';
import { embeddedFonts, type FontSource } from '$lib/export/pdfRender';

/**
 * The embedded JetBrains Mono faces, plus the Courier metrics that the chart
 * SVGs draw their labels with.
 *
 * pdfmake's browser bundle omits the standard-PDF-font metrics — they live in
 * `build/standard-fonts/*.js` and are meant to be registered by the host app.
 * Without this, `doc.font('Courier')` throws inside the worker and every chart
 * label is silently dropped from the PDF. The Node build has them compiled in,
 * so `preparePdfMake` only registers these where `addFontContainer` exists.
 */
export function browserFonts(): FontSource {
	return { ...embeddedFonts(), standardFonts: courierContainer.standardFonts };
}
