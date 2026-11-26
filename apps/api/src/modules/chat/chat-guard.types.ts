export type ChatState =
  | 'GREETING'
  | 'INTENT_CLARIFICATION'
  | 'VERTICAL_QUALIFIER_PENDING'
  | 'LOCALITY_PENDING'
  | 'EXPANSION_CAPTURE'
  | 'VENDOR_SELECTION'
  | 'BUSINESS_SERVICE_SELECTION'
  | 'SLOT_SELECTION'
  | 'CUSTOMER_DETAILS_PENDING'
  | 'AWAITING_BUSINESS_CONFIRMATION'
  | 'BUSINESS_PROPOSED_RESCHEDULE'
  | 'OTP_VERIFICATION_PENDING'
  | 'CALLBACK_CAPTURE'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';

export type BacktrackTargetState =
  | 'LOCALITY_PENDING'
  | 'VENDOR_SELECTION'
  | 'BUSINESS_SERVICE_SELECTION'
  | 'SLOT_SELECTION'
  | 'CUSTOMER_DETAILS_PENDING';

export type CollectedDataKey =
  | 'serviceIntent'
  | 'clarificationSubject'
  | 'verticalAttributes'
  | 'subLocality'
  | 'resolvedCity'
  | 'postalCode'
  | 'isServiceable'
  | 'selectedBusinessId'
  | 'selectedBusinessName'
  | 'selectedServiceIds'
  | 'selectedServiceNames'
  | 'selectedSlotId'
  | 'selectedSlotLabel'
  | 'customerName'
  | 'customerPhone'
  | 'serviceAddress'
  | 'otpCodeHash'
  | 'otpExpiresAt';

export interface CollectedData {
  serviceIntent?: string;
  clarificationSubject?: string;
  verticalAttributes?: Record<string, unknown>;
  subLocality?: string;
  resolvedCity?: string;
  postalCode?: string;
  isServiceable?: boolean;
  selectedBusinessId?: string;
  selectedBusinessName?: string;
  selectedServiceIds?: string[];
  selectedServiceNames?: string[];
  selectedSlotId?: string;
  selectedSlotLabel?: string;
  customerName?: string;
  customerPhone?: string;
  serviceAddress?: string;
  otpCodeHash?: string;
  otpExpiresAt?: string;
  [key: string]: unknown;
}

export type ExpectedInputKind =
  | 'INTENT_OR_CLARIFICATION'
  | 'VERTICAL_QUALIFIER'
  | 'LOCALITY_OR_PIN'
  | 'BUSINESS_SELECTION'
  | 'SERVICE_SELECTION'
  | 'SLOT_SELECTION'
  | 'CUSTOMER_DETAILS'
  | 'OTP_CODE'
  | 'CALLBACK_PHONE'
  | 'NONE';

export interface PromptOptionItem {
  id?: string;
  label: string;
  aliases?: string[];
}

export interface LastPromptMeta {
  expectedInput: ExpectedInputKind;
  stepPrompt?: string;
  formatExample?: string;
  allowsStandaloneDigits?: boolean;
  allowsSingleChar?: boolean;
  options?: PromptOptionItem[];
  activeQualifierKey?: string;
}

export type Layer4Category =
  | 'ANSWER_CURRENT_STEP'
  | 'MID_FLOW_CORRECTION'
  | 'OUT_OF_VERTICAL'
  | 'OFF_TOPIC';

export interface Layer4ClassificationResult {
  category: Layer4Category;
  extractedValue?: string;
  extractedFields?: Record<string, string>;
  targetField?:
    | 'serviceIntent'
    | 'verticalAttributes'
    | 'locality'
    | 'business'
    | 'service'
    | 'slot'
    | 'customerDetails';
  suggestedVerticalSlug?: string | null;
}

export interface GuardReplyPayload {
  message: string;
  quickReplies?: string[];
  clearCollectedData?: boolean;
  nextState?: ChatState;
  updatedCollectedData?: Partial<CollectedData>;
  incrementInvalidAttempts?: boolean;
  resetInvalidAttempts?: boolean;
  callbackRequested?: boolean;
}

export type GuardDecision =
  | {
      action: 'BLOCK_TERMINAL';
      httpStatus: 200;
      reply: GuardReplyPayload;
    }
  | {
      action: 'BLOCK_SECURITY';
      httpStatus: 400;
      errorCode: 'MAX_LENGTH_EXCEEDED' | 'CONTROL_CHARS' | 'INJECTION_DETECTED';
      message: string;
    }
  | {
      action: 'BLOCK_NSFW';
      httpStatus: 200;
      reply: GuardReplyPayload;
    }
  | {
      action: 'NAV_RESET';
      httpStatus: 200;
      reply: GuardReplyPayload;
    }
  | {
      action: 'NAV_BACKTRACK';
      httpStatus: 200;
      targetState: BacktrackTargetState;
      reply: GuardReplyPayload;
    }
  | {
      action: 'POSITIVE_MATCH';
      matchedValue?: unknown;
      extractedFields?: Record<string, unknown>;
    }
  | {
      action: 'REJECT_GIBBERISH';
      httpStatus: 200;
      rule: 'G1_EMPTY_OR_MICRO' | 'G2_REPETITION' | 'G3_KEYBOARD_OR_CONSONANTS' | 'G4_UNEXPECTED_DIGITS';
      reply: GuardReplyPayload;
    }
  | {
      action: 'LLM_CLASSIFY_NEEDED';
      context: {
        verticalSlug: string;
        verticalName: string;
        currentState: ChatState;
        expectedInput: ExpectedInputKind;
        collectedSummary: Record<string, unknown>;
        message: string;
      };
    };

export const TERMINAL_CHAT_STATES: ReadonlySet<ChatState> = new Set<ChatState>([
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
]);

export const MAX_CHAT_MESSAGE_LENGTH = 500;

export const RESET_COMMANDS: ReadonlySet<string> = new Set<string>([
  'start over',
  'reset',
  'restart',
  'start new booking',
  'cancel all',
]);

export const GENERIC_BACK_COMMANDS: ReadonlySet<string> = new Set<string>([
  'back',
  'go back',
  'previous',
  '<- back',
  '← back',
]);

export const EXPLICIT_BACKTRACK_MAP: Record<string, BacktrackTargetState> = {
  'change locality': 'LOCALITY_PENDING',
  'change location': 'LOCALITY_PENDING',
  'change area': 'LOCALITY_PENDING',
  'change city': 'LOCALITY_PENDING',
  'change business': 'VENDOR_SELECTION',
  'change vendor': 'VENDOR_SELECTION',
  'all businesses': 'VENDOR_SELECTION',
  'other providers': 'VENDOR_SELECTION',
  'change service': 'BUSINESS_SERVICE_SELECTION',
  'change services': 'BUSINESS_SERVICE_SELECTION',
  'edit services': 'BUSINESS_SERVICE_SELECTION',
  'change slot': 'SLOT_SELECTION',
  'change time': 'SLOT_SELECTION',
  'reschedule slot': 'SLOT_SELECTION',
  'change details': 'CUSTOMER_DETAILS_PENDING',
  'edit details': 'CUSTOMER_DETAILS_PENDING',
  'edit phone': 'CUSTOMER_DETAILS_PENDING',
  'edit address': 'CUSTOMER_DETAILS_PENDING',
};

/**
 * Dependency Invalidation Matrix:
 * Preserves upstream keys and clears only downstream dependent keys
 * when backtracking to a target state.
 */
export const BACKTRACK_DOWNSTREAM_KEYS: Record<
  BacktrackTargetState,
  readonly CollectedDataKey[]
> = {
  LOCALITY_PENDING: [
    'subLocality',
    'resolvedCity',
    'postalCode',
    'isServiceable',
    'selectedBusinessId',
    'selectedBusinessName',
    'selectedServiceIds',
    'selectedServiceNames',
    'selectedSlotId',
    'selectedSlotLabel',
  ],
  VENDOR_SELECTION: [
    'selectedBusinessId',
    'selectedBusinessName',
    'selectedServiceIds',
    'selectedServiceNames',
    'selectedSlotId',
    'selectedSlotLabel',
  ],
  BUSINESS_SERVICE_SELECTION: [
    'selectedServiceIds',
    'selectedServiceNames',
    'selectedSlotId',
    'selectedSlotLabel',
  ],
  SLOT_SELECTION: ['selectedSlotId', 'selectedSlotLabel'],
  CUSTOMER_DETAILS_PENDING: [
    'customerName',
    'customerPhone',
    'serviceAddress',
  ],
};