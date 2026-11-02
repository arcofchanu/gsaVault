/**
 * pdfmake ships the metrics for the 14 standard PDF fonts as separate,
 * untyped CommonJS files; the browser bundle deliberately leaves them out.
 * The chart SVGs need Courier (see `fonts.generated.ts`), so we load and
 * register it ourselves.
 */
declare module 'pdfmake/build/standard-fonts/Courier.js' {
	const container: { standardFonts: unknown[]; vfs?: Record<string, string>; fonts?: unknown };
	export default container;
}
