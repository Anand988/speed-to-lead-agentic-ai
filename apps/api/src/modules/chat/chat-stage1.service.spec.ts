import { ChatStage1Service, Stage1LocalityNode } from './chat-stage1.service.js';
import type {
  VerticalMetadataConfig,
  VerticalQualifierQuestion,
} from '../tenant/entities/vertical.entity.js';

describe('ChatStage1Service (Topic 2 — Qualifiers, Locality & Fast-Forward)', () => {
  let service: ChatStage1Service;

  const sampleQualifiers: VerticalQualifierQuestion[] = [
    {
      key: 'property_size',
      prompt: 'What is the size of your property?',
      type: 'enum',
      options: ['1BHK', '2BHK', '3BHK', '4BHK', 'Villa / Commercial'],
      aliases: {
        '3 bhk': '3BHK',
        'three bhk': '3BHK',
        villa: 'Villa / Commercial',
      },
      required: true,
      applicableIntents: ['Deep Cleaning', 'Move-in Cleaning'],
    },
    {
      key: 'urgency',
      prompt: 'When do you need this service?',
      type: 'enum',
      options: ['Today', 'Tomorrow', 'This Week'],
      required: true,
    },
    {
      key: 'notes',
      prompt: 'Any special instructions?',
      type: 'text',
      required: false,
    },
  ];

  const sampleMetadata: VerticalMetadataConfig = {
    qualifierQuestions: sampleQualifiers,
  };

  const localityNodes: Stage1LocalityNode[] = [
    {
      name: 'Gachibowli',
      aliases: ['gachi bowli', 'dlf cyber city'],
      parentCity: 'Hyderabad',
      postalCodes: ['500032'],
    },
    {
      name: 'Madhapur',
      aliases: ['hitech city', 'hi-tech city'],
      parentCity: 'Hyderabad',
      postalCodes: ['500081'],
    },
  ];

  beforeEach(() => {
    service = new ChatStage1Service();
  });

  // =========================================================================
  // 1. Dynamic Vertical Qualifiers
  // =========================================================================
  describe('getNextPendingQualifier', () => {
    it('returns null when vertical has no qualifierQuestions', () => {
      expect(service.getNextPendingQualifier({}, 'Deep Cleaning', {})).toBeNull();
    });

    it('returns first required applicable qualifier not yet answered', () => {
      const q = service.getNextPendingQualifier(
        sampleMetadata,
        'Deep Cleaning',
        {},
      );
      expect(q?.key).toBe('property_size');
    });

    it('skips qualifiers whose applicableIntents do not match', () => {
      const q = service.getNextPendingQualifier(
        sampleMetadata,
        'Sofa Shampooing',
        {},
      );
      expect(q?.key).toBe('urgency');
    });

    it('skips already-answered qualifiers and ignores optional ones', () => {
      const q1 = service.getNextPendingQualifier(sampleMetadata, 'Deep Cleaning', {
        property_size: '3BHK',
      });
      expect(q1?.key).toBe('urgency');

      const q2 = service.getNextPendingQualifier(sampleMetadata, 'Deep Cleaning', {
        property_size: '3BHK',
        urgency: 'Tomorrow',
      });
      expect(q2).toBeNull();
    });
  });

  // =========================================================================
  // 2. Qualifier Answer Validation (0 Tokens)
  // =========================================================================
  describe('validateQualifierAnswer', () => {
    it('validates enum canonical options and normalizes aliases', () => {
      const propQ = sampleQualifiers[0];
      expect(service.validateQualifierAnswer(propQ, '2bhk')).toEqual({
        valid: true,
        normalizedValue: '2BHK',
      });
      expect(service.validateQualifierAnswer(propQ, 'three bhk')).toEqual({
        valid: true,
        normalizedValue: '3BHK',
      });
      expect(service.validateQualifierAnswer(propQ, 'castle')).toEqual({
        valid: false,
      });
    });

    it('validates number and text qualifier types', () => {
      const numQ: VerticalQualifierQuestion = {
        key: 'ac_units',
        prompt: 'How many AC units?',
        type: 'number',
        required: true,
      };
      expect(service.validateQualifierAnswer(numQ, '2')).toEqual({
        valid: true,
        normalizedValue: 2,
      });
      expect(service.validateQualifierAnswer(numQ, '0')).toEqual({ valid: false });
      expect(service.validateQualifierAnswer(numQ, 'two')).toEqual({ valid: false });

      const textQ = sampleQualifiers[2];
      expect(service.validateQualifierAnswer(textQ, 'Pet friendly')).toEqual({
        valid: true,
        normalizedValue: 'Pet friendly',
      });
      expect(service.validateQualifierAnswer(textQ, 'a')).toEqual({ valid: false });
    });
  });

  // =========================================================================
  // 3. 4-Priority Sub-Locality, Alias & PIN Resolution (0 Tokens)
  // =========================================================================
  describe('resolveLocality', () => {
    it('Priority 1: resolves exact PIN code to subLocality and parentCity', () => {
      expect(service.resolveLocality('500032', localityNodes)).toEqual({
        matched: true,
        matchPriority: 'PIN',
        subLocality: 'Gachibowli',
        resolvedCity: 'Hyderabad',
        postalCode: '500032',
        normalizedInput: '500032',
      });
    });

    it('Priority 1: returns matched=false for unknown PIN while preserving postalCode', () => {
      const res = service.resolveLocality('411001', localityNodes);
      expect(res.matched).toBe(false);
      expect(res.postalCode).toBe('411001');
    });

    it('Priority 2: resolves exact name and alias matches', () => {
      const byAlias = service.resolveLocality('DLF Cyber City', localityNodes);
      expect(byAlias).toMatchObject({
        matched: true,
        matchPriority: 'NAME_OR_ALIAS',
        subLocality: 'Gachibowli',
        resolvedCity: 'Hyderabad',
        postalCode: '500032',
      });
    });

    it('Priority 3: resolves parent city match', () => {
      const byCity = service.resolveLocality('Hyderabad', localityNodes);
      expect(byCity).toMatchObject({
        matched: true,
        matchPriority: 'PARENT_CITY',
        subLocality: 'Hyderabad',
        resolvedCity: 'Hyderabad',
      });
    });

    it('Priority 4: resolves comma-split primary segment', () => {
      const bySegment = service.resolveLocality('Hi-Tech City, Hyd', localityNodes);
      expect(bySegment).toMatchObject({
        matched: true,
        matchPriority: 'COMMA_SEGMENT',
        subLocality: 'Madhapur',
        resolvedCity: 'Hyderabad',
        postalCode: '500081',
      });
    });

    it('returns matched=false with fallback subLocality for expansion market', () => {
      const expansion = service.resolveLocality('Pune, Maharashtra', localityNodes);
      expect(expansion).toMatchObject({
        matched: false,
        matchPriority: 'NONE',
        subLocality: 'Pune',
        resolvedCity: null,
      });
    });
  });

  // =========================================================================
  // 4. Single-Shot Fast-Forward Router
  // =========================================================================
  describe('determineNextStage1Step', () => {
    it('routes to VERTICAL_QUALIFIER_PENDING when a required qualifier is missing', () => {
      const res = service.determineNextStage1Step(sampleMetadata, {
        serviceIntent: 'Deep Cleaning',
        subLocality: 'Gachibowli',
      });
      expect(res.nextState).toBe('VERTICAL_QUALIFIER_PENDING');
      if (res.nextState === 'VERTICAL_QUALIFIER_PENDING') {
        expect(res.pendingQualifier.key).toBe('property_size');
      }
    });

    it('routes to LOCALITY_PENDING when qualifiers are satisfied but locality is missing', () => {
      const res = service.determineNextStage1Step(sampleMetadata, {
        serviceIntent: 'Deep Cleaning',
        verticalAttributes: { property_size: '3BHK', urgency: 'Today' },
      });
      expect(res).toEqual({ nextState: 'LOCALITY_PENDING' });
    });

    it('fast-forwards to READY_FOR_VENDORS when qualifiers and locality are both present', () => {
      const res = service.determineNextStage1Step(sampleMetadata, {
        serviceIntent: 'Deep Cleaning',
        verticalAttributes: { property_size: '3BHK', urgency: 'Today' },
        subLocality: 'Gachibowli',
      });
      expect(res).toEqual({ nextState: 'READY_FOR_VENDORS' });
    });
  });
});