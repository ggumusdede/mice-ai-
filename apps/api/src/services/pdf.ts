// Template-based PDF rendering (pdfkit). Documents are generated FROM DATA (§3.1); no data lives in the PDF.
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';

const FONT_CANDIDATES = [
  process.env.PDF_FONT_PATH,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
].filter((x): x is string => !!x);
const BOLD_CANDIDATES = [
  process.env.PDF_FONT_BOLD_PATH,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
].filter((x): x is string => !!x);
const FONT = FONT_CANDIDATES.find((f) => existsSync(f)) ?? null;
const FONT_BOLD = BOLD_CANDIDATES.find((f) => existsSync(f)) ?? FONT;

/** Built-in Helvetica has no ş/ğ/ı — transliterate only when no Unicode TTF font is available. */
function t(s: string): string {
  if (FONT) return s;
  return s.replace(/ş/g, 's').replace(/Ş/g, 'S').replace(/ğ/g, 'g').replace(/Ğ/g, 'G').replace(/ı/g, 'i').replace(/İ/g, 'I');
}

export interface PdfTable {
  title?: string;
  columns: { label: string; width: number; align?: 'left' | 'right' }[];
  rows: string[][];
  footer?: { label: string; value: string; bold?: boolean }[];
}

export interface PdfSpec {
  header: { agencyName: string; title: string; subtitle?: string; meta: [string, string][] };
  sections: ({ kind: 'table'; table: PdfTable } | { kind: 'text'; title?: string; lines: string[] })[];
  footerNote?: string;
}

export function renderPdf(spec: PdfSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: spec.header.title, Author: spec.header.agencyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const regular = FONT ?? 'Helvetica';
    const bold = FONT_BOLD ?? 'Helvetica-Bold';

    doc.font(bold).fontSize(16).text(t(spec.header.agencyName));
    doc.moveDown(0.2).font(bold).fontSize(13).text(t(spec.header.title));
    if (spec.header.subtitle) doc.font(regular).fontSize(10).fillColor('#555').text(t(spec.header.subtitle)).fillColor('black');
    doc.moveDown(0.5).font(regular).fontSize(9);
    for (const [k, v] of spec.header.meta) doc.text(t(`${k}: ${v}`));
    doc.moveDown();

    for (const s of spec.sections) {
      if (doc.y > 720) doc.addPage();
      if (s.kind === 'text') {
        if (s.title) doc.font(bold).fontSize(11).text(t(s.title));
        doc.font(regular).fontSize(9);
        for (const l of s.lines) doc.text(t(l));
        doc.moveDown();
        continue;
      }
      const tb = s.table;
      if (tb.title) doc.font(bold).fontSize(11).text(t(tb.title)).moveDown(0.3);
      const x0 = doc.page.margins.left;
      const drawRow = (cells: string[], isBold: boolean) => {
        if (doc.y > 760) doc.addPage();
        const y = doc.y;
        let x = x0;
        let h = 0;
        doc.font(isBold ? bold : regular).fontSize(8.5);
        tb.columns.forEach((c, i) => {
          const txt = t(cells[i] ?? '');
          doc.text(txt, x, y, { width: c.width - 4, align: c.align ?? 'left' });
          h = Math.max(h, doc.heightOfString(txt, { width: c.width - 4 }));
          x += c.width;
        });
        doc.x = x0;
        doc.y = y + h + 3;
      };
      drawRow(tb.columns.map((c) => c.label), true);
      doc.moveTo(x0, doc.y).lineTo(x0 + tb.columns.reduce((a, c) => a + c.width, 0), doc.y).strokeColor('#999').stroke();
      doc.y += 2;
      for (const r of tb.rows) drawRow(r, false);
      if (tb.footer) {
        doc.moveDown(0.3);
        for (const f of tb.footer) {
          doc.font(f.bold ? bold : regular).fontSize(9).text(t(`${f.label}: ${f.value}`), x0, doc.y, { align: 'right' });
        }
      }
      doc.x = x0;
      doc.moveDown();
    }
    if (spec.footerNote) doc.moveDown().font(regular).fontSize(8).fillColor('#555').text(t(spec.footerNote)).fillColor('black');
    doc.end();
  });
}

export function money(n: number, currency: string): string {
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function pct(n: number): string {
  return `%${(n * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;
}
