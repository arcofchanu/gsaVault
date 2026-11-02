// Local-only SPA: everything (IndexedDB, parsing, PDF) runs in the browser, so
// there is nothing to render on a server and nothing to prerender. The static
// adapter emits `index.html` as the fallback shell for every route.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'ignore';
