/**
 * Save a Blob to disk without leaving the browser. No network, no data: URI in
 * the address bar — just an object URL revoked straight after the click.
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	anchor.style.display = 'none';
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	// Revoke on the next task so the browser has started the download.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(text: string, filename: string, type = 'application/json'): void {
	downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}
