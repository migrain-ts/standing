// Plain data for the demo seed. Everything here is fictional.
export type SectionData = { name: string; rows: number; seatsPerRow: number; priceCents: number };
export type TenantData = { name: string; slug: string; venue: string; sections: SectionData[] };
export type EventData = {
  name: string;
  tenant: string; // TenantData.name
  startsInHours: number;
  soldFraction: number;
  status: 'published' | 'draft';
  /** Extra orders spread over the last 55 minutes so the live chart is not empty. */
  recentOrders?: number;
  /** Fraction of tickets scanned at the door. */
  scannedFraction?: number;
};

export const TENANTS: readonly TenantData[] = [
  {
    name: 'Blue Note Live', slug: 'blue-note-live', venue: 'Blue Note Hall',
    sections: [
      { name: 'Floor', rows: 15, seatsPerRow: 30, priceCents: 7500 },
      { name: 'Balcony', rows: 7, seatsPerRow: 50, priceCents: 5000 },
    ],
  },
  {
    name: 'Halcyon Arena', slug: 'halcyon-arena', venue: 'Halcyon Arena',
    sections: [
      { name: 'Pit', rows: 30, seatsPerRow: 40, priceCents: 12000 },
      { name: 'Lower A', rows: 25, seatsPerRow: 40, priceCents: 9000 },
      { name: 'Lower B', rows: 25, seatsPerRow: 40, priceCents: 9000 },
      { name: 'Upper A', rows: 20, seatsPerRow: 40, priceCents: 6000 },
      { name: 'Upper B', rows: 20, seatsPerRow: 40, priceCents: 6000 },
    ],
  },
  {
    name: 'Rue Cadet Comedy', slug: 'rue-cadet-comedy', venue: 'Cadet Club',
    sections: [
      { name: 'Stalls', rows: 25, seatsPerRow: 40, priceCents: 4500 },
      { name: 'Circle', rows: 10, seatsPerRow: 50, priceCents: 3000 },
    ],
  },
];

const pub = (tenant: string, name: string, startsInHours: number, soldFraction: number, extra: Partial<EventData> = {}): EventData => ({
  name, tenant, startsInHours, soldFraction, status: 'published', ...extra,
});
const d = (days: number) => days * 24;

export const EVENTS: readonly EventData[] = [
  pub('Blue Note Live', 'Aurora Night', 48, 0.5, { recentOrders: 40 }),
  pub('Blue Note Live', 'Velvet Sessions', d(9), 0.62),
  pub('Blue Note Live', 'The Midnight Quartet', d(16), 0.35),
  pub('Blue Note Live', 'Neon Strings', d(30), 0.2),
  pub('Blue Note Live', 'Solstice Jazz Festival', d(45), 0.12),
  pub('Halcyon Arena', 'Skyline Tour: Hollow Pines', d(6), 0.88),
  pub('Halcyon Arena', 'Electric Harbor Live', d(13), 0.71),
  pub('Halcyon Arena', 'Nova Collective', d(21), 0.4),
  pub('Halcyon Arena', 'Echoes of Tomorrow', d(35), 0.28),
  pub('Halcyon Arena', 'Ironclad Summer Slam', d(60), 0.09),
  pub('Rue Cadet Comedy', 'Late Night Laughs', 5, 0.85, { recentOrders: 40, scannedFraction: 0.3 }),
  pub('Rue Cadet Comedy', 'Stand-up Wednesday', d(8), 0.66),
  pub('Rue Cadet Comedy', 'Improv Royale', d(20), 0.45),
  pub('Rue Cadet Comedy', 'Fresh Voices Showcase', d(27), 0.3),
  pub('Rue Cadet Comedy', 'The Big Comedy Gala', d(50), 0.15),
  { name: 'Winter Warm-up (draft)', tenant: 'Blue Note Live', startsInHours: d(75), soldFraction: 0, status: 'draft' },
  { name: 'Autumn Preview (draft)', tenant: 'Halcyon Arena', startsInHours: d(80), soldFraction: 0, status: 'draft' },
];

export const FIRST_NAMES = [
  'Ada', 'Bruno', 'Clara', 'Dario', 'Elena', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jonas',
  'Kira', 'Leo', 'Mira', 'Nico', 'Olga', 'Pablo', 'Quinn', 'Rosa', 'Sven', 'Tessa',
] as const;
export const LAST_NAMES = [
  'Almeida', 'Brandt', 'Castellan', 'Dumont', 'Eriksen', 'Fontaine', 'Garnier', 'Hollis', 'Ivanov', 'Jansen',
  'Kovacs', 'Lindqvist', 'Moreau', 'Novak', 'Okafor', 'Petrov', 'Quintana', 'Rossi', 'Sorensen', 'Tanaka',
] as const;
