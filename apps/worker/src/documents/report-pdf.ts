import PDFDocument from 'pdfkit';
import { collect, money } from './ticket-pdf';

export type ReportPdfData = {
  eventName: string;
  generatedAt: Date;
  ticketsSold: number;
  revenueCents: number;
  capacity: number;
  /** Tickets sold per UTC day, ascending. */
  days: readonly { day: string; tickets: number }[];
  sections: readonly { name: string; capacity: number; sold: number; revenueCents: number }[];
};

export async function renderReportPdf(d: ReportPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Report ${d.eventName}` } });
  const done = collect(doc);
  const left = 40;
  const width = 595 - 80;
  doc.font('Helvetica-Bold').fontSize(22).text(d.eventName, left, 40, { width });
  doc.font('Helvetica').fontSize(9).fillColor('#444444').text(`Sales report generated ${d.generatedAt.toISOString()}`, { width });
  doc.fillColor('#000000');

  const fill = d.capacity > 0 ? `${((d.ticketsSold / d.capacity) * 100).toFixed(1)}%` : '0.0%';
  const kpis: [string, string][] = [['Tickets sold', String(d.ticketsSold)], ['Revenue', money(d.revenueCents)], ['Capacity', String(d.capacity)], ['Fill rate', fill]];
  const kw = width / 4;
  kpis.forEach(([label, value], i) => {
    const x = left + i * kw;
    doc.font('Helvetica').fontSize(9).fillColor('#444444').text(label, x, 100, { width: kw, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#000000').text(value, x, 114, { width: kw, lineBreak: false });
  });

  doc.font('Helvetica-Bold').fontSize(12).text('Tickets sold per day (UTC)', left, 160);
  const chartTop = 185;
  const chartH = 110;
  const max = Math.max(1, ...d.days.map((x) => x.tickets));
  const slot = d.days.length > 0 ? width / d.days.length : width;
  const barW = Math.min(40, slot * 0.7);
  d.days.forEach((day, i) => {
    const h = (day.tickets / max) * chartH;
    const x = left + i * slot + (slot - barW) / 2;
    doc.rect(x, chartTop + chartH - h, barW, h).fill('#3b6ea5');
    doc.fillColor('#000000').font('Helvetica').fontSize(7).text(String(day.tickets), x - 10, chartTop + chartH - h - 9, { width: barW + 20, align: 'center', lineBreak: false });
    if (d.days.length <= 14) doc.text(day.day.slice(5), x - 10, chartTop + chartH + 3, { width: barW + 20, align: 'center', lineBreak: false });
  });
  doc.rect(left, chartTop + chartH, width, 0.5).fill('#999999');
  if (d.days.length === 0) doc.fillColor('#444444').font('Helvetica').fontSize(9).text('No sales yet', left, chartTop + 40, { width, align: 'center' });

  let y = chartTop + chartH + 40;
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(12).text('Sections', left, y);
  y += 22;
  const cols = [left, left + 200, left + 260, left + 320, left + 400];
  const head = ['Section', 'Capacity', 'Sold', 'Revenue', 'Fill'];
  doc.font('Helvetica-Bold').fontSize(9);
  head.forEach((h, i) => doc.text(h, cols[i] ?? left, y, { width: 100, lineBreak: false }));
  y += 16;
  doc.font('Helvetica').fontSize(9);
  for (const s of d.sections) {
    [s.name, String(s.capacity), String(s.sold), money(s.revenueCents)].forEach((v, i) =>
      doc.text(v, cols[i] ?? left, y, { width: i === 0 ? 190 : 60, lineBreak: false, ellipsis: true }));
    const ratio = s.capacity > 0 ? s.sold / s.capacity : 0;
    doc.rect(cols[4] ?? left, y + 1, 100, 7).fill('#dddddd');
    doc.rect(cols[4] ?? left, y + 1, 100 * ratio, 7).fill('#3b6ea5');
    doc.fillColor('#000000');
    y += 15;
  }
  doc.font('Helvetica').fontSize(7).fillColor('#444444').text('Standing demo report - fictional data, simulated payments', left, 790, { width, align: 'center', lineBreak: false });
  doc.end();
  return done;
}
