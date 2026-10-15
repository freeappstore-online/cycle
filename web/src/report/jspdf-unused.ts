// Stands in for jsPDF's optional html2canvas, canvg and dompurify (see
// vite.config.ts). They're only used by doc.html() and SVG images, which the
// text-only doctor PDF never calls; leaving them out keeps ~100 KB gzipped out
// of the service worker's precache.
export default function notBundled(): never {
  throw new Error('Not bundled: Cycle only renders text PDFs.')
}
export const Canvg = notBundled
