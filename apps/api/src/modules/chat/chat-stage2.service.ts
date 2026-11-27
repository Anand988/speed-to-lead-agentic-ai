import { Injectable } from '@nestjs/common';

export interface Stage2VendorOption {
  id: string;
  name: string;
  locality?: string;
  rating?: number;
}

export interface Stage2ServiceOption {
  id: string;
  name: string;
  description?: string;
  basePrice?: number | string | null;
  durationMinutes?: number;
}

export interface Stage2AppointmentBlock {
  startTime: Date | string;
  status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | string;
  durationMinutes?: number;
}

export interface Stage2SlotOption {
  id: string;
  label: string; // e.g., "Tomorrow, 10:00 AM"
  startIso: string; // UTC ISO string for Appointment.startTime
  endIso: string;
}

export interface GenerateSlotsOptions {
  now?: Date;
  existingAppointments?: Stage2AppointmentBlock[];
  durationMinutes?: number;
  daysAhead?: number;
  workdayStartHourIst?: number;
  workdayEndHourIst?: number;
  leadTimeMinutes?: number;
  maxSlots?: number;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  '1st': 1,
  one: 1,
  second: 2,
  '2nd': 2,
  two: 2,
  third: 3,
  '3rd': 3,
  three: 3,
  fourth: 4,
  '4th': 4,
  four: 4,
  fifth: 5,
  '5th': 5,
  five: 5,
  sixth: 6,
  '6th': 6,
  six: 6,
  seventh: 7,
  '7th': 7,
  seven: 7,
  eighth: 8,
  '8th': 8,
  eight: 8,
};

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

@Injectable()
export class ChatStage2Service {
  /**
   * 0-Token Deterministic Vendor Matcher:
   * Priority: Exact ID -> Exact Name -> Ordinal ("1", "first") -> Substring Name
   */
  matchVendor<T extends Stage2VendorOption>(
    rawInput: string,
    vendors: T[],
  ): T | null {
    if (!Array.isArray(vendors) || vendors.length === 0) return null;
    const trimmed = (rawInput ?? '').trim();
    if (!trimmed) return null;

    const normalized = this.normalize(trimmed);

    // 1. Exact ID match
    const byId = vendors.find((v) => v.id === trimmed);
    if (byId) return byId;

    // 2. Exact normalized name match
    const byExactName = vendors.find((v) => this.normalize(v.name) === normalized);
    if (byExactName) return byExactName;

    // 3. Ordinal selection ("1", "option 1", "#2", "first")
    const ordinalIdx = this.parseOrdinalIndex(normalized);
    if (ordinalIdx !== null && ordinalIdx >= 0 && ordinalIdx < vendors.length) {
      return vendors[ordinalIdx];
    }

    // 4. Substring match (min 3 chars to avoid accidental single-letter matches)
    if (normalized.length >= 3) {
      const bySubstring = vendors.find((v) => {
        const normName = this.normalize(v.name);
        return normName.includes(normalized) || normalized.includes(normName);
      });
      if (bySubstring) return bySubstring;
    }

    return null;
  }

  /**
   * Filters a vendor's services using vertical.metadata.serviceFilterKeywords.
   * Falls back to all services if no keyword bucket matches or filter yields empty.
   */
  filterServicesForIntent<T extends Stage2ServiceOption>(
    services: T[],
    serviceIntent: string | null | undefined,
    serviceFilterKeywords?: Record<string, string[]>,
  ): T[] {
    if (!Array.isArray(services) || services.length === 0) return [];
    if (!serviceIntent || !serviceFilterKeywords) return services;

    const normIntent = this.normalize(serviceIntent);
    let matchedKeywords: string[] = [];

    for (const [intentKey, keywords] of Object.entries(serviceFilterKeywords)) {
      const normKey = this.normalize(intentKey);
      if (
        normIntent.includes(normKey) ||
        normKey.includes(normIntent)
      ) {
        matchedKeywords = keywords;
        break;
      }
    }

    if (matchedKeywords.length === 0) return services;

    const filtered = services.filter((svc) => {
      const haystack = this.normalize(`${svc.name} ${svc.description ?? ''}`);
      return matchedKeywords.some((kw) => haystack.includes(this.normalize(kw)));
    });

    return filtered.length > 0 ? filtered : services;
  }

  /**
   * 0-Token Deterministic Service Package Matcher:
   * Priority: Exact ID -> Exact Name (ignoring price suffix) -> Ordinal -> Substring
   */
  matchService<T extends Stage2ServiceOption>(
    rawInput: string,
    services: T[],
  ): T | null {
    if (!Array.isArray(services) || services.length === 0) return null;
    const trimmed = (rawInput ?? '').trim();
    if (!trimmed) return null;

    const normalized = this.normalize(trimmed);
    const withoutPrice = this.stripPriceSuffix(normalized);

    // 1. Exact ID match
    const byId = services.find((s) => s.id === trimmed);
    if (byId) return byId;

    // 2. Exact name match (with or without chip price suffix)
    const byExact = services.find((s) => {
      const normName = this.normalize(s.name);
      return normName === normalized || normName === withoutPrice;
    });
    if (byExact) return byExact;

    // 3. Ordinal selection
    const ordinalIdx = this.parseOrdinalIndex(normalized);
    if (ordinalIdx !== null && ordinalIdx >= 0 && ordinalIdx < services.length) {
      return services[ordinalIdx];
    }

    // 4. Substring match
    if (withoutPrice.length >= 3) {
      const bySub = services.find((s) => {
        const normName = this.normalize(s.name);
        return normName.includes(withoutPrice) || withoutPrice.includes(normName);
      });
      if (bySub) return bySub;
    }

    return null;
  }

  /**
   * Generates deterministic, conflict-free IST slots across Today + (daysAhead - 1) days.
   * Excludes slots within the lead-time buffer and slots overlapping non-CANCELLED appointments.
   */
  generateAvailableSlots(options: GenerateSlotsOptions = {}): Stage2SlotOption[] {
    const {
      now = new Date(),
      existingAppointments = [],
      durationMinutes = 60,
      daysAhead = 3,
      workdayStartHourIst = 9,
      workdayEndHourIst = 18,
      leadTimeMinutes = 60,
      maxSlots = 6,
    } = options;

    const safeDuration = durationMinutes > 0 ? durationMinutes : 60;
    const earliestAllowedMs = now.getTime() + leadTimeMinutes * MINUTE_MS;

    // Precompute blocked intervals from non-CANCELLED appointments
    const blockedIntervals = existingAppointments
      .filter((appt) => (appt.status ?? 'CONFIRMED').toUpperCase() !== 'CANCELLED')
      .map((appt) => {
        const startMs = new Date(appt.startTime).getTime();
        const blockDuration = appt.durationMinutes && appt.durationMinutes > 0
          ? appt.durationMinutes
          : 60;
        return {
          startMs,
          endMs: startMs + blockDuration * MINUTE_MS,
        };
      })
      .filter((interval) => Number.isFinite(interval.startMs));

    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const baseYear = istNow.getUTCFullYear();
    const baseMonth = istNow.getUTCMonth();
    const baseDay = istNow.getUTCDate();

    const slots: Stage2SlotOption[] = [];

    for (let dayOffset = 0; dayOffset < daysAhead && slots.length < maxSlots; dayOffset++) {
      const startMinutesOfDay = workdayStartHourIst * 60;
      const endMinutesOfDay = workdayEndHourIst * 60;

      for (
        let minuteCursor = startMinutesOfDay;
        minuteCursor + safeDuration <= endMinutesOfDay && slots.length < maxSlots;
        minuteCursor += safeDuration
      ) {
        const hour = Math.floor(minuteCursor / 60);
        const minute = minuteCursor % 60;

        // Convert IST wall-clock time to exact UTC epoch ms
        const slotStartMs =
          Date.UTC(baseYear, baseMonth, baseDay + dayOffset, hour, minute, 0, 0) -
          IST_OFFSET_MS;
        const slotEndMs = slotStartMs + safeDuration * MINUTE_MS;

        if (slotStartMs < earliestAllowedMs) continue;

        const hasOverlap = blockedIntervals.some(
          (block) => slotStartMs < block.endMs && slotEndMs > block.startMs,
        );
        if (hasOverlap) continue;

        const startDate = new Date(slotStartMs);
        const endDate = new Date(slotEndMs);

        slots.push({
          id: `slot_${startDate.toISOString()}`,
          label: this.formatIstSlotLabel(slotStartMs, dayOffset),
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
        });
      }
    }

    return slots;
  }

  /**
   * 0-Token Deterministic Slot Matcher:
   * Priority: Exact ID -> Exact/Normalized Label -> Ordinal -> Normalized Time Phrase
   */
  matchSlot(rawInput: string, slots: Stage2SlotOption[]): Stage2SlotOption | null {
    if (!Array.isArray(slots) || slots.length === 0) return null;
    const trimmed = (rawInput ?? '').trim();
    if (!trimmed) return null;

    // 1. Exact ID match
    const byId = slots.find((s) => s.id === trimmed);
    if (byId) return byId;

    const normalized = this.normalize(trimmed);

    // 2. Exact normalized label match
    const byExactLabel = slots.find((s) => this.normalize(s.label) === normalized);
    if (byExactLabel) return byExactLabel;

    // 3. Ordinal selection ("1", "option 2", "first")
    const ordinalIdx = this.parseOrdinalIndex(normalized);
    if (ordinalIdx !== null && ordinalIdx >= 0 && ordinalIdx < slots.length) {
      return slots[ordinalIdx];
    }

    // 4. Canonical time-phrase match (e.g., "tomorrow 10 am" -> "tomorrow 10am")
    const canonicalInput = this.canonicalizeSlotPhrase(normalized);
    if (canonicalInput.length >= 3) {
      const byPhrase = slots.find((s) => {
        const canonicalLabel = this.canonicalizeSlotPhrase(this.normalize(s.label));
        return (
          canonicalLabel === canonicalInput ||
          canonicalLabel.includes(canonicalInput) ||
          canonicalInput.includes(canonicalLabel)
        );
      });
      if (byPhrase) return byPhrase;
    }

    return null;
  }

  private formatIstSlotLabel(slotStartUtcMs: number, dayOffset: number): string {
    const istDate = new Date(slotStartUtcMs + IST_OFFSET_MS);
    const hours24 = istDate.getUTCHours();
    const minutes = istDate.getUTCMinutes();
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    const minStr = minutes.toString().padStart(2, '0');
    const timePart = `${hours12}:${minStr} ${period}`;

    if (dayOffset === 0) return `Today, ${timePart}`;
    if (dayOffset === 1) return `Tomorrow, ${timePart}`;

    const dayName = SHORT_DAYS[istDate.getUTCDay()];
    const monthName = SHORT_MONTHS[istDate.getUTCMonth()];
    const dayNum = istDate.getUTCDate();
    return `${dayName}, ${monthName} ${dayNum}, ${timePart}`;
  }

  private parseOrdinalIndex(normalized: string): number | null {
    // Handles "1", "#1", "option 1", "choice 2", "slot 3"
    const numericMatch = normalized.match(/^(?:option|choice|slot|vendor|service|#)?\s*(\d+)$/);
    if (numericMatch) {
      const num = parseInt(numericMatch[1], 10);
      return num >= 1 ? num - 1 : null;
    }

    // Handles "first", "the second one", "2nd"
    const cleaned = normalized.replace(/^(?:the\s+)?/, '').replace(/\s+one$/, '');
    if (ORDINAL_WORDS[cleaned] !== undefined) {
      return ORDINAL_WORDS[cleaned] - 1;
    }

    return null;
  }

  private stripPriceSuffix(normalized: string): string {
    // Strips trailing " (₹1499)" or " - ₹599" or " ($99)" from quick-reply chips
    return normalized
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s*[-–]\s*(?:₹|rs\.?|inr|\$)?\s*\d[\d,.]*\s*$/, '')
      .trim();
  }

  private canonicalizeSlotPhrase(normalized: string): string {
    return normalized
      .replace(/,/g, ' ')
      .replace(/:00\b/g, '')
      .replace(/\s+(am|pm)\b/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}