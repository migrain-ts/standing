export const DEMO_USERS = {
  organizer: 'organizer@demo.standing.local',
  buyer: 'buyer@demo.standing.local',
  door: 'door@demo.standing.local',
} as const;
export type DemoPersona = keyof typeof DEMO_USERS;
export const DEMO_PASSWORD = 'standing-demo-1';

export const MAX_SEATS_PER_HOLD = 8;
export const MAX_RUSH_BUYERS = 5000;
export const MAX_SEATS_PER_VENUE = 6000;

export type TenantRoleName = 'owner' | 'manager' | 'door';
