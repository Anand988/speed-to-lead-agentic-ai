import {
  ChatStage2Service,
  Stage2VendorOption,
  Stage2ServiceOption,
  Stage2AppointmentBlock,
} from './chat-stage2.service.js';

describe('ChatStage2Service (Topic 3 — Vendor, Service & IST Slot Engine)', () => {
  let service: ChatStage2Service;

  const vendors: Stage2VendorOption[] = [
    { id: 'v-1', name: 'Deccan Sparkle Cleaners', locality: 'Gachibowli', rating: 4.9 },
    { id: 'v-2', name: 'Hyderabad Hygiene Pros', locality: 'Madhapur', rating: 4.7 },
  ];

  const services: Stage2ServiceOption[] = [
    { id: 's-1', name: '3BHK Deep Cleaning', basePrice: 4999 },
    { id: 's-2', name: 'Sofa Shampooing', description: '5-seater fabric sofa', basePrice: 799 },
    { id: 's-3', name: 'Kitchen Degreasing', basePrice: 1499 },
  ];

  beforeEach(() => {
    service = new ChatStage2Service();
  });

  // =========================================================================
  // 1. Deterministic Vendor Matching (0 Tokens)
  // =========================================================================
  describe('matchVendor', () => {
    it('matches by exact ID, exact name, ordinal, and substring', () => {
      expect(service.matchVendor('v-2', vendors)?.id).toBe('v-2');
      expect(service.matchVendor('deccan sparkle cleaners', vendors)?.id).toBe('v-1');
      expect(service.matchVendor('1', vendors)?.id).toBe('v-1');
      expect(service.matchVendor('option 2', vendors)?.id).toBe('v-2');
      expect(service.matchVendor('first', vendors)?.id).toBe('v-1');
      expect(service.matchVendor('Hygiene Pros', vendors)?.id).toBe('v-2');
    });

    it('returns null for out-of-range ordinals or unknown names', () => {
      expect(service.matchVendor('5', vendors)).toBeNull();
      expect(service.matchVendor('Unknown Cleaners', vendors)).toBeNull();
      expect(service.matchVendor('a', vendors)).toBeNull();
    });
  });

  // =========================================================================
  // 2. Service Filtering & Matching (0 Tokens)
  // =========================================================================
  describe('filterServicesForIntent', () => {
    const keywordMap = {
      sofa: ['sofa', 'upholstery'],
      carpet: ['carpet', 'rug'],
    };

    it('filters services when intent matches a keyword bucket', () => {
      const filtered = service.filterServicesForIntent(services, 'Sofa Cleaning', keywordMap);
      expect(filtered.map((s) => s.id)).toEqual(['s-2']);
    });

    it('falls back to all services when filter yields empty or no bucket matches', () => {
      const emptyFilter = service.filterServicesForIntent(services, 'Carpet Cleaning', keywordMap);
      expect(emptyFilter).toHaveLength(3);

      const noBucket = service.filterServicesForIntent(services, 'General Maintenance', keywordMap);
      expect(noBucket).toHaveLength(3);
    });
  });

  describe('matchService', () => {
    it('matches by ID, name, chip with price suffix, ordinal, and substring', () => {
      expect(service.matchService('s-3', services)?.id).toBe('s-3');
      expect(service.matchService('Sofa Shampooing', services)?.id).toBe('s-2');
      expect(service.matchService('Sofa Shampooing (₹799)', services)?.id).toBe('s-2');
      expect(service.matchService('Kitchen Degreasing - ₹1,499', services)?.id).toBe('s-3');
      expect(service.matchService('second', services)?.id).toBe('s-2');
      expect(service.matchService('Deep Cleaning', services)?.id).toBe('s-1');
    });

    it('returns null for invalid service input', () => {
      expect(service.matchService('9', services)).toBeNull();
      expect(service.matchService('Roof Painting', services)).toBeNull();
    });
  });

  // =========================================================================
  // 3. IST Slot Generation & Conflict Filtering
  // =========================================================================
  describe('generateAvailableSlots', () => {
    // 2026-11-26T10:30:00.000Z === Thursday, Nov 26, 2026 4:00 PM IST
    const fixedNow = new Date('2026-11-26T10:30:00.000Z');

    it('applies 60-min lead-time buffer for Today and formats IST labels accurately', () => {
      const slots = service.generateAvailableSlots({
        now: fixedNow,
        maxSlots: 4,
      });

      expect(slots).toHaveLength(4);
      // 4:00 PM IST + 60m buffer => 5:00 PM IST is the only slot left Today (before 6:00 PM end)
      expect(slots[0].label).toBe('Today, 5:00 PM');
      expect(slots[0].startIso).toBe('2026-11-26T11:30:00.000Z');
      expect(slots[1].label).toBe('Tomorrow, 9:00 AM');
      expect(slots[2].label).toBe('Tomorrow, 10:00 AM');
      expect(slots[3].label).toBe('Tomorrow, 11:00 AM');
    });

    it('excludes overlapping CONFIRMED/PENDING appointments but allows CANCELLED ones', () => {
      const existingAppointments: Stage2AppointmentBlock[] = [
        // Blocks Today, 5:00 PM IST
        { startTime: '2026-11-26T11:30:00.000Z', status: 'CONFIRMED' },
        // Blocks Tomorrow, 9:00 AM IST (03:30 UTC)
        { startTime: '2026-11-27T03:30:00.000Z', status: 'PENDING' },
        // Cancelled at Tomorrow, 10:00 AM IST (04:30 UTC) -> should remain available
        { startTime: '2026-11-27T04:30:00.000Z', status: 'CANCELLED' },
      ];

      const slots = service.generateAvailableSlots({
        now: fixedNow,
        existingAppointments,
        maxSlots: 3,
      });

      expect(slots.map((s) => s.label)).toEqual([
        'Tomorrow, 10:00 AM',
        'Tomorrow, 11:00 AM',
        'Tomorrow, 12:00 PM',
      ]);
    });

    it('returns empty array when all slots in the window are booked', () => {
      const allDayOneWindow = service.generateAvailableSlots({
        now: fixedNow,
        daysAhead: 1,
        existingAppointments: [
          { startTime: '2026-11-26T11:30:00.000Z', status: 'CONFIRMED' },
        ],
      });

      expect(allDayOneWindow).toEqual([]);
    });
  });

  // =========================================================================
  // 4. Deterministic Slot Matching (0 Tokens)
  // =========================================================================
  describe('matchSlot', () => {
    const fixedNow = new Date('2026-11-26T10:30:00.000Z');

    it('matches by exact ID, exact label, ordinal, and canonical time phrase', () => {
      const slots = service.generateAvailableSlots({ now: fixedNow, maxSlots: 4 });

      expect(service.matchSlot(slots[0].id, slots)?.id).toBe(slots[0].id);
      expect(service.matchSlot('Tomorrow, 10:00 AM', slots)?.id).toBe(slots[2].id);
      expect(service.matchSlot('2', slots)?.id).toBe(slots[1].id);
      expect(service.matchSlot('third', slots)?.id).toBe(slots[2].id);
      expect(service.matchSlot('tomorrow 10 am', slots)?.id).toBe(slots[2].id);
      expect(service.matchSlot('today 5pm', slots)?.id).toBe(slots[0].id);
    });

    it('returns null for non-matching slot input', () => {
      const slots = service.generateAvailableSlots({ now: fixedNow, maxSlots: 3 });
      expect(service.matchSlot('next month', slots)).toBeNull();
      expect(service.matchSlot('10', slots)).toBeNull();
    });
  });
});