import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export type TicketPdfData = {
  eventName: string;
  startsAt: Date;
  venueName: string;
  orderId: string;
  tickets: readonly { code: string; sectionName: string; rowLabel: string; number: number; priceCents: number }[];
};

export const TICKET_FOOTER = 'FICTIONAL DEMO TICKET - NOT VALID FOR ENTRY ANYWHERE';
export const money = (cents: number) => `${(cents / 100).toFixed(2)}`;

export function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** One 360 x 520 page per ticket, built-in Helvetica only. */
export async function renderTicketPdf(data: TicketPdfData): Promise<Buffer> {
  if (data.tickets.length === 0) throw new Error('No tickets to render');
  const doc = new PDFDocument({ size: [360, 520], margin: 24, autoFirstPage: false, info: { Title: `Tickets ${data.eventName}` } });
  const done = collect(doc);
  const w = 360 - 48;
  for (const tk of data.tickets) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(20).text(data.eventName, 24, 28, { width: w });
    doc.font('Helvetica').fontSize(10).fillColor('#444444')
      .text(`${data.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, { width: w })
      .text(data.venueName, { width: w });
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(16).text(tk.sectionName, 24, 120, { width: w });
    doc.fontSize(26).text(`Row ${tk.rowLabel}  Seat ${tk.number}`, { width: w });
    doc.font('Helvetica').fontSize(11).text(`Price ${money(tk.priceCents)}`, { width: w });
    const qr = await QRCode.toBuffer(tk.code, { margin: 1, width: 220 });
    doc.image(qr, (360 - 220) / 2, 220, { width: 220, height: 220 });
    doc.font('Helvetica').fontSize(7).fillColor('#444444').text(`Order ${data.orderId}`, 24, 450, { width: w, align: 'center', lineBreak: false });
    doc.text(TICKET_FOOTER, 24, 470, { width: w, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}
