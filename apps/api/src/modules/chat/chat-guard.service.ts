import { Injectable } from '@nestjs/common';
import {
  BACKTRACK_DOWNSTREAM_KEYS,
  BacktrackTargetState,
  ChatState,
  CollectedData,
  EXPLICIT_BACKTRACK_MAP,
  GENERIC_BACK_COMMANDS,
  GuardDecision,
  GuardReplyPayload,
  LastPromptMeta,
  Layer4ClassificationResult,
  MAX_CHAT_MESSAGE_LENGTH,
  RESET_COMMANDS,
  TERMINAL_CHAT_STATES,
} from '../chat/chat-guard.types.js';

export interface EvaluateTurnInput {
  rawMessage: string;
  state: ChatState;
  collectedData: CollectedData;
  invalidAttempts: number;
  lastPromptMeta?: LastPromptMeta | null;
  verticalSlug: string;
  verticalName: string;
  /** Optional DB-backed deterministic terms for GREETING / INTENT_CLARIFICATION */
  verticalDeterministicTerms?: string[];
}

const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(drop\s+table|delete\s+from|union\s+select|insert\s+into|update\s+\w+\s+set)\b/i,
  /(\bor\s+1\s*=\s*1\b|--\s*$|;--|\$ne\b|\$gt\b)/i,
  /(<\s*script\b|javascript:|onerror\s*=|onload\s*=)/i,
  /\b(ignore\s+(all\s+)?previous\s+instructions|ignore\s+all\s+rules|reveal\s+your\s+(system\s+)?(prompt|instructions)|system\s+prompt|act\s+as\s+dan)\b/i,
];

/**
 * Word-boundary matched profanity/abuse list so domain terms like
 * "cockroach", "assessment", "screw", or "breast" never false-positive.
 */
const NSFW_ABUSE_REGEX =
  /\b(fuck|fucking|fucked|shit|shitty|bitch|bastard|asshole|dickhead|motherfucker|cunt|whore|slut|porn|nude|nudes|kill\s+yourself|rape)\b/i;

const KEYBOARD_SMASH_REGEX =
  /(asdf|sdfg|dfgh|fghj|ghjk|hjkl|qwer|wert|erty|rtyu|tyui|yuio|uiop|zxcv|xcvb|cvbn|vbnm)/i;

const VOWEL_LESS_CONSONANT_RUN_REGEX = /[bcdfghjklmnpqrstvwxz]{5,}/i;
const REPEATED_CHAR_REGEX = /(.)\1{3,}/;
const PURE_DIGITS_REGEX = /^\d+$/;
const PIN_CODE_REGEX = /^\d{5,6}$/;
const OTP_CODE_REGEX = /^\d{6}$/;
const PHONE_NUMBER_REGEX = /(?:\+91[\s-]?)?([6-9]\d{9})\b/;

const DIGIT_ALLOWED_STATES: ReadonlySet<ChatState> = new Set<ChatState>([
  'LOCALITY_PENDING',
  'EXPANSION_CAPTURE',
  'CUSTOMER_DETAILS_PENDING',
  'OTP_VERIFICATION_PENDING',
  'CALLBACK_CAPTURE',
]);

const ORDINAL_SELECTION_STATES: ReadonlySet<ChatState> = new Set<ChatState>([
  'VENDOR_SELECTION',
  'BUSINESS_SERVICE_SELECTION',
  'SLOT_SELECTION',
  'INTENT_CLARIFICATION',
]);

const DEFAULT_STEP_EXAMPLES: Record<ChatState, string> = {
  GREETING: 'Tap one of the service options above or describe what you need.',
  INTENT_CLARIFICATION: 'Tap one of the clarified service options above.',
  VERTICAL_QUALIFIER_PENDING: 'Tap one of the options above to specify your requirement.',
  LOCALITY_PENDING: 'Enter your area name (e.g., "Gachibowli") or a 6-digit PIN code (e.g., "500032").',
  EXPANSION_CAPTURE: 'Enter a valid 10-digit mobile number (e.g., "9876543210").',
  VENDOR_SELECTION: 'Tap one of the businesses above or type the business name.',
  BUSINESS_SERVICE_SELECTION: 'Tap one or more services above, then confirm your selection.',
  SLOT_SELECTION: 'Tap an available time slot above or type a preferred date and time like "Tomorrow 10 AM".',
  CUSTOMER_DETAILS_PENDING: 'Share your name, 10-digit mobile number, and service address.',
  AWAITING_BUSINESS_CONFIRMATION: 'Your request is with the business. You can wait for confirmation or type "change business".',
  BUSINESS_PROPOSED_RESCHEDULE: 'Tap one of the proposed alternate slots or type "change business".',
  OTP_VERIFICATION_PENDING: 'Enter the 6-digit OTP sent to your phone, or type "resend otp".',
  CALLBACK_CAPTURE: 'Enter your 10-digit mobile number (e.g., "9876543210") for a callback.',
  CONFIRMED: 'This booking is confirmed. Tap "Start New Booking" for a new request.',
  COMPLETED: 'This booking is completed. Tap "Start New Booking" for a new request.',
  CANCELLED: 'This booking was cancelled. Tap "Start New Booking" for a new request.',
};

const PARENT_STATE_MAP: Partial<Record<ChatState, BacktrackTargetState>> = {
  VENDOR_SELECTION: 'LOCALITY_PENDING',
  BUSINESS_SERVICE_SELECTION: 'VENDOR_SELECTION',
  SLOT_SELECTION: 'BUSINESS_SERVICE_SELECTION',
  CUSTOMER_DETAILS_PENDING: 'SLOT_SELECTION',
  AWAITING_BUSINESS_CONFIRMATION: 'SLOT_SELECTION',
  BUSINESS_PROPOSED_RESCHEDULE: 'SLOT_SELECTION',
  OTP_VERIFICATION_PENDING: 'CUSTOMER_DETAILS_PENDING',
};

@Injectable()
export class ChatGuardService {
  /**
   * Executes Layers 1, 2, and 3 synchronously at 0 LLM tokens.
   * Returns LLM_CLASSIFY_NEEDED only for coherent natural language that
   * did not match Layers 1–3A and passed Layer 3B gibberish checks.
   */
  evaluateTurn(input: EvaluateTurnInput): GuardDecision {
    const {
      rawMessage,
      state,
      collectedData,
      invalidAttempts,
      lastPromptMeta,
      verticalSlug,
      verticalName,
      verticalDeterministicTerms = [],
    } = input;

    // ------------------------------------------------------------------
    // LAYER 1: Security, Abuse & Terminal-State Gate (0 Tokens)
    // ------------------------------------------------------------------
    if (TERMINAL_CHAT_STATES.has(state)) {
      return {
        action: 'BLOCK_TERMINAL',
        httpStatus: 200,
        reply: {
          message:
            'This booking session is already closed. Would you like to start a new booking?',
          quickReplies: ['Start New Booking'],
          incrementInvalidAttempts: false,
        },
      };
    }

    if (typeof rawMessage !== 'string' || rawMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      return {
        action: 'BLOCK_SECURITY',
        httpStatus: 400,
        errorCode: 'MAX_LENGTH_EXCEEDED',
        message: `Message must be a string of at most ${MAX_CHAT_MESSAGE_LENGTH} characters.`,
      };
    }

    if (CONTROL_CHAR_REGEX.test(rawMessage)) {
      return {
        action: 'BLOCK_SECURITY',
        httpStatus: 400,
        errorCode: 'CONTROL_CHARS',
        message: 'Invalid control characters detected in message.',
      };
    }

    const trimmed = rawMessage.trim();
    const normalized = this.normalizeText(trimmed);

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          action: 'BLOCK_SECURITY',
          httpStatus: 400,
          errorCode: 'INJECTION_DETECTED',
          message: 'Invalid or unsafe input detected.',
        };
      }
    }

    if (NSFW_ABUSE_REGEX.test(trimmed)) {
      return {
        action: 'BLOCK_NSFW',
        httpStatus: 200,
        reply: {
          message:
            'Please keep the conversation respectful so I can help with your booking.',
          quickReplies: this.extractQuickReplies(lastPromptMeta),
          incrementInvalidAttempts: false,
        },
      };
    }

    // ------------------------------------------------------------------
    // LAYER 2: Deterministic Navigation, Reset & Dependency Backtrack (0 Tokens)
    // ------------------------------------------------------------------
    if (RESET_COMMANDS.has(normalized)) {
      return {
        action: 'NAV_RESET',
        httpStatus: 200,
        reply: {
          message: 'No problem—let us start fresh.',
          clearCollectedData: true,
          nextState: 'GREETING',
          resetInvalidAttempts: true,
        },
      };
    }

    if (normalized === 'request a callback' || normalized === 'callback') {
      return {
        action: 'POSITIVE_MATCH',
        matchedValue: 'REQUEST_CALLBACK',
        extractedFields: { callbackRequested: true },
      };
    }

    const explicitTarget = EXPLICIT_BACKTRACK_MAP[normalized];
    const genericTarget = GENERIC_BACK_COMMANDS.has(normalized)
      ? PARENT_STATE_MAP[state]
      : undefined;
    const backtrackTarget = explicitTarget ?? genericTarget;

    if (backtrackTarget) {
      const cleanedData = this.invalidateDownstreamData(
        collectedData,
        backtrackTarget,
      );
      return {
        action: 'NAV_BACKTRACK',
        httpStatus: 200,
        targetState: backtrackTarget,
        reply: {
          message: `Sure, let us update that step.`,
          nextState: backtrackTarget,
          updatedCollectedData: cleanedData,
          resetInvalidAttempts: true,
        },
      };
    }

    // ------------------------------------------------------------------
    // LAYER 3A: State-Aware Positive Match (0 Tokens)
    // ------------------------------------------------------------------
    const positiveMatch = this.checkPositiveMatch(
      trimmed,
      normalized,
      state,
      lastPromptMeta,
      verticalDeterministicTerms,
    );
    if (positiveMatch) {
      return positiveMatch;
    }

    // ------------------------------------------------------------------
    // LAYER 3B: 0-Token Gibberish & Shape Heuristic
    // ------------------------------------------------------------------
    const gibberishRule = this.detectGibberish(trimmed, state, lastPromptMeta);
    if (gibberishRule) {
      const nextAttempts = invalidAttempts + 1;
      return {
        action: 'REJECT_GIBBERISH',
        httpStatus: 200,
        rule: gibberishRule,
        reply: this.buildRecoveryReply(state, nextAttempts, lastPromptMeta),
      };
    }

    // ------------------------------------------------------------------
    // LAYER 4: Defer Coherent Natural Language to Tiny LLM Classifier
    // ------------------------------------------------------------------
    return {
      action: 'LLM_CLASSIFY_NEEDED',
      context: {
        verticalSlug,
        verticalName,
        currentState: state,
        expectedInput: lastPromptMeta?.expectedInput ?? 'NONE',
        collectedSummary: this.buildCollectedSummary(collectedData),
        message: trimmed,
      },
    };
  }

  /**
   * Applies the Dependency Invalidation Matrix for a backtrack target state,
   * preserving all upstream fields and clearing only downstream dependents.
   */
  invalidateDownstreamData(
    collectedData: CollectedData,
    targetState: BacktrackTargetState,
  ): CollectedData {
    const nextData: CollectedData = { ...collectedData };
    for (const key of BACKTRACK_DOWNSTREAM_KEYS[targetState]) {
      delete nextData[key];
    }
    return nextData;
  }

  /**
   * Builds the 3-Strike Recovery Ladder response (shared by Layer 3B & Layer 4 OFF_TOPIC).
   */
  buildRecoveryReply(
    state: ChatState,
    attemptNumber: number,
    lastPromptMeta?: LastPromptMeta | null,
    customLeadIn?: string,
  ): GuardReplyPayload {
    const baseReplies = this.extractQuickReplies(lastPromptMeta);
    const stepHint =
      lastPromptMeta?.formatExample ||
      DEFAULT_STEP_EXAMPLES[state] ||
      'Please choose one of the options above.';

    if (attemptNumber === 1) {
      return {
        message:
          customLeadIn ??
          `I didn't quite catch that. ${lastPromptMeta?.stepPrompt ?? stepHint}`,
        quickReplies: baseReplies,
        incrementInvalidAttempts: true,
      };
    }

    if (attemptNumber === 2) {
      return {
        message: customLeadIn
          ? `${customLeadIn} ${stepHint}`
          : `Let's make sure we get this right: ${stepHint}`,
        quickReplies: baseReplies,
        incrementInvalidAttempts: true,
      };
    }

    // Strike 3+: Append escape hatches ("Request a Callback" + "Start Over")
    const escapeReplies = Array.from(
      new Set([...baseReplies, 'Request a Callback', 'Start Over']),
    );

    return {
      message:
        'It looks like we are having trouble with this step. You can try again, request a quick callback from our team, or start over.',
      quickReplies: escapeReplies,
      incrementInvalidAttempts: true,
    };
  }

  /**
   * Compact prompt builder for Layer 4 (max_tokens: 60).
   */
  buildLayer4ClassifierPrompt(context: {
    verticalSlug: string;
    verticalName: string;
    currentState: ChatState;
    expectedInput: string;
    collectedSummary: Record<string, unknown>;
    message: string;
  }): { system: string; user: string } {
    const system = [
      'You are a strict JSON classifier for a service-booking chat.',
      'Return ONLY valid JSON with key "category" set to one of:',
      '"ANSWER_CURRENT_STEP" | "MID_FLOW_CORRECTION" | "OUT_OF_VERTICAL" | "OFF_TOPIC".',
      'Optional keys: "extractedValue", "targetField", "suggestedVerticalSlug".',
      'No prose, no markdown fences.',
    ].join(' ');

    const user = JSON.stringify({
      vertical: `${context.verticalName} (${context.verticalSlug})`,
      state: context.currentState,
      expected: context.expectedInput,
      collected: context.collectedSummary,
      message: context.message,
    });

    return { system, user };
  }

  /**
   * Safely parses Layer 4 LLM JSON output; defaults to OFF_TOPIC on malformed output.
   */
  parseLayer4Response(rawText: string): Layer4ClassificationResult {
    try {
      const cleaned = rawText
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Partial<Layer4ClassificationResult>;
      const validCategories = new Set([
        'ANSWER_CURRENT_STEP',
        'MID_FLOW_CORRECTION',
        'OUT_OF_VERTICAL',
        'OFF_TOPIC',
      ]);

      if (parsed.category && validCategories.has(parsed.category)) {
        return {
          category: parsed.category,
          extractedValue: parsed.extractedValue,
          extractedFields: parsed.extractedFields,
          targetField: parsed.targetField,
          suggestedVerticalSlug: parsed.suggestedVerticalSlug ?? null,
        };
      }
    } catch {
      // Fall through to safe OFF_TOPIC default
    }
    return { category: 'OFF_TOPIC' };
  }

  // ------------------------------------------------------------------
  // Private Helpers
  // ------------------------------------------------------------------

  private checkPositiveMatch(
    trimmed: string,
    normalized: string,
    state: ChatState,
    lastPromptMeta?: LastPromptMeta | null,
    verticalDeterministicTerms: string[] = [],
  ): GuardDecision | null {
    // 1. Direct match against active prompt options (ID, label, or alias)
    if (lastPromptMeta?.options?.length) {
      // Support multi-select comma-separated IDs/labels in BUSINESS_SERVICE_SELECTION
      if (state === 'BUSINESS_SERVICE_SELECTION') {
        if (normalized === 'confirm services' || normalized === 'proceed') {
          return { action: 'POSITIVE_MATCH', matchedValue: 'CONFIRM_SERVICES' };
        }
        const parts = trimmed
          .split(',')
          .map((p) => this.normalizeText(p))
          .filter(Boolean);
        if (parts.length > 0) {
          const matchedOptions = parts
            .map((part) => this.findMatchingOption(part, lastPromptMeta.options!))
            .filter((opt): opt is NonNullable<typeof opt> => Boolean(opt));
          if (matchedOptions.length === parts.length) {
            return {
              action: 'POSITIVE_MATCH',
              matchedValue: matchedOptions.map((o) => o.id ?? o.label),
            };
          }
        }
      } else {
        const matched = this.findMatchingOption(normalized, lastPromptMeta.options);
        if (matched) {
          return {
            action: 'POSITIVE_MATCH',
            matchedValue: matched.id ?? matched.label,
          };
        }
      }
    }

    // 2. State-specific deterministic patterns
    switch (state) {
      case 'GREETING':
      case 'INTENT_CLARIFICATION': {
        const hit = verticalDeterministicTerms.find(
          (term) => this.normalizeText(term) === normalized,
        );
        if (hit) {
          return { action: 'POSITIVE_MATCH', matchedValue: hit };
        }
        return null;
      }

      case 'LOCALITY_PENDING': {
        if (PIN_CODE_REGEX.test(trimmed)) {
          return {
            action: 'POSITIVE_MATCH',
            matchedValue: trimmed,
            extractedFields: { postalCode: trimmed },
          };
        }
        return null;
      }

      case 'OTP_VERIFICATION_PENDING': {
        if (normalized === 'resend otp' || normalized === 'resend') {
          return { action: 'POSITIVE_MATCH', matchedValue: 'RESEND_OTP' };
        }
        if (OTP_CODE_REGEX.test(trimmed)) {
          return {
            action: 'POSITIVE_MATCH',
            matchedValue: trimmed,
            extractedFields: { otpCode: trimmed },
          };
        }
        return null;
      }

      case 'EXPANSION_CAPTURE':
      case 'CALLBACK_CAPTURE': {
        const phoneMatch = trimmed.match(PHONE_NUMBER_REGEX);
        if (phoneMatch) {
          return {
            action: 'POSITIVE_MATCH',
            matchedValue: phoneMatch[1],
            extractedFields: { customerPhone: phoneMatch[1] },
          };
        }
        return null;
      }

      case 'CUSTOMER_DETAILS_PENDING': {
        const phoneMatch = trimmed.match(PHONE_NUMBER_REGEX);
        if (phoneMatch) {
          return {
            action: 'POSITIVE_MATCH',
            matchedValue: trimmed,
            extractedFields: { customerPhone: phoneMatch[1] },
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  private detectGibberish(
    trimmed: string,
    state: ChatState,
    lastPromptMeta?: LastPromptMeta | null,
  ):
    | 'G1_EMPTY_OR_MICRO'
    | 'G2_REPETITION'
    | 'G3_KEYBOARD_OR_CONSONANTS'
    | 'G4_UNEXPECTED_DIGITS'
    | null {
    // Allow 1-based ordinal selections ("1", "2", "#1", "1.") in option-selection states
    if (ORDINAL_SELECTION_STATES.has(state)) {
      const normalizedOrdinal = trimmed.replace(/^[#\s]+|[.\)\s]+$/g, '');
      if (/^[1-9]\d?$/.test(normalizedOrdinal)) {
        return null;
      }
    }

    // G1: Empty / punctuation-only / single-character micro-noise
    const alnumOnly = trimmed.replace(/[^a-zA-Z0-9]/g, '');
    if (
      alnumOnly.length === 0 ||
      (alnumOnly.length === 1 && !lastPromptMeta?.allowsSingleChar)
    ) {
      return 'G1_EMPTY_OR_MICRO';
    }

    // G4: Unexpected pure digits in non-numeric states
    const digitsAllowed =
      DIGIT_ALLOWED_STATES.has(state) ||
      Boolean(lastPromptMeta?.allowsStandaloneDigits);
    if (PURE_DIGITS_REGEX.test(trimmed) && !digitsAllowed) {
      return 'G4_UNEXPECTED_DIGITS';
    }

    // G2: Repetition spam (4+ identical consecutive chars or low unique-char ratio)
    if (REPEATED_CHAR_REGEX.test(trimmed)) {
      return 'G2_REPETITION';
    }
    if (alnumOnly.length >= 6) {
      const uniqueCount = new Set(alnumOnly.toLowerCase()).size;
      if (uniqueCount / alnumOnly.length < 0.25) {
        return 'G2_REPETITION';
      }
    }

    // G3: Keyboard smash or 5+ consecutive consonants without vowels
    if (KEYBOARD_SMASH_REGEX.test(trimmed)) {
      return 'G3_KEYBOARD_OR_CONSONANTS';
    }

    // Check word-by-word so uppercase acronyms/codes (e.g., "HVAC", "BHK") aren't flagged
    const words = trimmed.split(/\s+/);
    for (const word of words) {
      const lettersOnly = word.replace(/[^a-zA-Z]/g, '');
      const isAllUppercaseAcronym =
        lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
      if (
        !isAllUppercaseAcronym &&
        VOWEL_LESS_CONSONANT_RUN_REGEX.test(lettersOnly)
      ) {
        return 'G3_KEYBOARD_OR_CONSONANTS';
      }
    }

    return null;
  }

  private findMatchingOption(
    normalizedInput: string,
    options: NonNullable<LastPromptMeta['options']>,
  ) {
    return options.find((opt) => {
      if (opt.id && this.normalizeText(opt.id) === normalizedInput) return true;
      if (this.normalizeText(opt.label) === normalizedInput) return true;
      if (
        opt.aliases?.some(
          (alias) => this.normalizeText(alias) === normalizedInput,
        )
      ) {
        return true;
      }
      return false;
    });
  }

  private extractQuickReplies(lastPromptMeta?: LastPromptMeta | null): string[] {
    if (!lastPromptMeta?.options?.length) return [];
    return lastPromptMeta.options.map((opt) => opt.label);
  }

  private buildCollectedSummary(
    collectedData: CollectedData,
  ): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    const keys: Array<keyof CollectedData> = [
      'serviceIntent',
      'subLocality',
      'resolvedCity',
      'selectedBusinessName',
      'selectedServiceNames',
      'selectedSlotLabel',
    ];
    for (const key of keys) {
      if (collectedData[key] !== undefined && collectedData[key] !== null) {
        summary[key] = collectedData[key];
      }
    }
    return summary;
  }

  private normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}