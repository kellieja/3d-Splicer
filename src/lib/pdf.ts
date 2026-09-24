/*
 * A tiny PDF writer: A4 pages with Helvetica text, lines and JPEG images.
 * Enough for a printable guide without pulling in a PDF library.
 */

export type PdfItem =
  | { type: 'text'; x: number; y: number; size: number; text: string; bold?: boolean; color?: [number, number, number] }
  | { type: 'image'; x: number; y: number; w: number; h: number; image: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: [number, number, number] }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color?: [number, number, number] };

export interface PdfImage {
  /** JPEG file bytes. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** Page size in points (1/72 inch). */
export const A4 = { w: 595.28, h: 841.89 };

/** Keeps text to the characters the built-in PDF fonts can show. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e°]/g, '');
}

const esc = (s: string) => pdfSafe(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Rough Helvetica text width, for centring and wrapping. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[il.,:;'|!]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.66 : 0.52;
  return w * size;
}

export function buildPdf(pages: PdfItem[][], images: PdfImage[], title = 'Document'): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? latin1(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | (() => void)) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    if (typeof body === 'string') write(body);
    else body();
    write('\nendobj\n');
  };

  // Object numbers: 1 catalog, 2 pages, 3 font, 4 bold font, 5 info, then images, then page + content pairs.
  const imageBase = 6;
  const pageBase = imageBase + images.length;
  const pageIds = pages.map((_, i) => pageBase + i * 2);

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  object(5, `<< /Title (${esc(title)}) /Producer (3D Splicer) >>`);
  images.forEach((img, i) => {
    object(imageBase + i, () => {
      write(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
      );
      write(img.jpeg);
      write('\nendstream');
    });
  });

  const xobjects = images.map((_, i) => `/Im${i} ${imageBase + i} 0 R`).join(' ');
  pages.forEach((items, i) => {
    const pageId = pageIds[i], contentId = pageId + 1;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.w)} ${n(A4.h)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjects} >> >> /Contents ${contentId} 0 R >>`,
    );
    const ops: string[] = [];
    for (const it of items) {
      if (it.type === 'text') {
        const [r, g, b] = it.color ?? [0.1, 0.1, 0.12];
        ops.push(`BT /${it.bold ? 'F2' : 'F1'} ${n(it.size)} Tf ${n(r)} ${n(g)} ${n(b)} rg ${n(it.x)} ${n(it.y)} Td (${esc(it.text)}) Tj ET`);
      } else if (it.type === 'image') {
        ops.push(`q ${n(it.w)} 0 0 ${n(it.h)} ${n(it.x)} ${n(it.y)} cm /Im${it.image} Do Q`);
      } else if (it.type === 'rect') {
        const [r, g, b] = it.color;
        ops.push(`${n(r)} ${n(g)} ${n(b)} rg ${n(it.x)} ${n(it.y)} ${n(it.w)} ${n(it.h)} re f`);
      } else {
        const [r, g, b] = it.color ?? [0.8, 0.8, 0.82];
        ops.push(`${n(r)} ${n(g)} ${n(b)} RG 0.6 w ${n(it.x1)} ${n(it.y1)} m ${n(it.x2)} ${n(it.y2)} l S`);
      }
    }
    const stream = latin1(ops.join('\n'));
    object(contentId, () => {
      write(`<< /Length ${stream.length} >>\nstream\n`);
      write(stream);
      write('\nendstream');
    });
  });

  const total = pageBase + pages.length * 2;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  write(table);
  write(`trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Encodes a string byte-per-character (the PDF syntax and WinAnsi text are single-byte). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
