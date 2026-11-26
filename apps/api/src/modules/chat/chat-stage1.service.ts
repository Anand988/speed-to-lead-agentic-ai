import { Injectable } from '@nestjs/common';
import type {
  VerticalMetadataConfig,
  VerticalQualifierQuestion,
} from '../tenant/entities/vertical.entity.js';
import type { CollectedData } from './chat-guard.types.js';

export interface Stage1LocalityNode {
  name: string;
  aliases?: string[];
  parentCity: string;
  postalCodes: string[];
}

export interface ResolvedLocalityResult {
  matched: boolean;
  matchPriority: 'PIN' | 'NAME_OR_ALIAS' | 'PARENT_CITY' | 'COMMA_SEGMENT' | 'NONE';
  subLocality: string | null;
  resolvedCity: string | null;
  postalCode: string | null;
  normalizedInput: string;
}

export interface QualifierValidationResult {
  valid: boolean;
  normalizedValue?: string | number;
}

export type Stage1NextStepDecision =
  | {
      nextState: 'VERTICAL_QUALIFIER_PENDING';
      pendingQualifier: VerticalQualifierQuestion;
    }
  | {
      nextState: 'LOCALITY_PENDING';
    }
  | {
      nextState: 'READY_FOR_VENDORS';
    };

const PIN_CODE_REGEX = /^\d{5,6}$/;
const NUMERIC_VALUE_REGEX = /^\d+(\.\d+)?$/;

@Injectable()
export class ChatStage1Service {
  /**
   * Returns the first required qualifier question applicable to `serviceIntent`
   * that has not yet been answered in `verticalAttributes`.
   */
  getNextPendingQualifier(
    metadata: VerticalMetadataConfig | null | undefined,
    serviceIntent: string | null | undefined,
    verticalAttributes: Record<string, unknown> | null | undefined,
  ): VerticalQualifierQuestion | null {
    const questions = metadata?.qualifierQuestions;
    if (!Array.isArray(questions) || questions.length === 0) {
      return null;
    }

    const attrs = verticalAttributes ?? {};
    const normalizedIntent = this.normalize(serviceIntent ?? '');

    for (const q of questions) {
      if (!q.required) continue;

      // Skip if already answered
      const existing = attrs[q.key];
      if (
        existing !== undefined &&
        existing !== null &&
        String(existing).trim().length > 0
      ) {
        continue;
      }

      // Check applicableIntents filter if configured
      if (Array.isArray(q.applicableIntents) && q.applicableIntents.length > 0) {
        if (!normalizedIntent) continue;
        const applies = q.applicableIntents.some((allowed) => {
          const normAllowed = this.normalize(allowed);
          return (
            normAllowed === normalizedIntent ||
            normalizedIntent.includes(normAllowed) ||
            normAllowed.includes(normalizedIntent)
          );
        });
        if (!applies) continue;
      }

      return q;
    }

    return null;
  }

  /**
   * Deterministically validates a user's reply to an active VerticalQualifierQuestion (0 tokens).
   */
  validateQualifierAnswer(
    question: VerticalQualifierQuestion,
    rawInput: string,
  ): QualifierValidationResult {
    const trimmed = (rawInput ?? '').trim();
    if (!trimmed) {
      return { valid: false };
    }

    const normalized = this.normalize(trimmed);

    if (question.type === 'enum') {
      // 1. Check aliases first
      if (question.aliases && typeof question.aliases === 'object') {
        for (const [aliasKey, canonicalValue] of Object.entries(question.aliases)) {
          if (this.normalize(aliasKey) === normalized) {
            return { valid: true, normalizedValue: canonicalValue };
          }
        }
      }

      // 2. Check canonical options
      if (Array.isArray(question.options)) {
        const matchedOption = question.options.find(
          (opt) => this.normalize(opt) === normalized,
        );
        if (matchedOption) {
          return { valid: true, normalizedValue: matchedOption };
        }
      }

      return { valid: false };
    }

    if (question.type === 'number') {
      if (!NUMERIC_VALUE_REGEX.test(trimmed)) {
        return { valid: false };
      }
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num <= 0) {
        return { valid: false };
      }
      return { valid: true, normalizedValue: num };
    }

    // type === 'text'
    if (trimmed.length >= 2) {
      return { valid: true, normalizedValue: trimmed };
    }

    return { valid: false };
  }

  /**
   * 4-Priority Deterministic Sub-Locality, Alias & PIN Resolution (0 tokens).
   * Priority 1: Exact Postal / PIN code
   * Priority 2: Exact locality name or alias
   * Priority 3: Parent city match
   * Priority 4: Comma-split primary segment (e.g., "Madhapur, Hyd")
   */
  resolveLocality(
    rawInput: string,
    nodes: Stage1LocalityNode[],
  ): ResolvedLocalityResult {
    const trimmed = (rawInput ?? '').trim();
    const normalizedInput = this.normalize(trimmed);

    if (!normalizedInput) {
      return {
        matched: false,
        matchPriority: 'NONE',
        subLocality: null,
        resolvedCity: null,
        postalCode: null,
        normalizedInput: '',
      };
    }

    // Priority 1: Exact 5–6 digit Postal / PIN code
    if (PIN_CODE_REGEX.test(trimmed)) {
      const pinNode = nodes.find((node) =>
        (node.postalCodes ?? []).some(
          (code) => this.normalize(code) === normalizedInput,
        ),
      );
      if (pinNode) {
        return {
          matched: true,
          matchPriority: 'PIN',
          subLocality: pinNode.name,
          resolvedCity: pinNode.parentCity || pinNode.name,
          postalCode: trimmed,
          normalizedInput,
        };
      }
      return {
        matched: false,
        matchPriority: 'NONE',
        subLocality: null,
        resolvedCity: null,
        postalCode: trimmed,
        normalizedInput,
      };
    }

    // Priority 2: Exact name or alias match
    const exactMatch = this.findByNameOrAlias(normalizedInput, nodes);
    if (exactMatch) {
      return {
        matched: true,
        matchPriority: 'NAME_OR_ALIAS',
        subLocality: exactMatch.name,
        resolvedCity: exactMatch.parentCity || exactMatch.name,
        postalCode: exactMatch.postalCodes?.[0] ?? null,
        normalizedInput,
      };
    }

    // Priority 3: Parent city match
    const parentMatch = nodes.find(
      (node) => this.normalize(node.parentCity) === normalizedInput,
    );
    if (parentMatch) {
      return {
        matched: true,
        matchPriority: 'PARENT_CITY',
        subLocality: parentMatch.parentCity,
        resolvedCity: parentMatch.parentCity,
        postalCode: null,
        normalizedInput,
      };
    }

    // Priority 4: Comma-split primary segment (e.g., "Madhapur, Hyd")
    if (trimmed.includes(',')) {
      const primarySegment = this.normalize(trimmed.split(',')[0]);
      if (primarySegment) {
        const segmentNode = this.findByNameOrAlias(primarySegment, nodes);
        if (segmentNode) {
          return {
            matched: true,
            matchPriority: 'COMMA_SEGMENT',
            subLocality: segmentNode.name,
            resolvedCity: segmentNode.parentCity || segmentNode.name,
            postalCode: segmentNode.postalCodes?.[0] ?? null,
            normalizedInput,
          };
        }

        const segmentParent = nodes.find(
          (node) => this.normalize(node.parentCity) === primarySegment,
        );
        if (segmentParent) {
          return {
            matched: true,
            matchPriority: 'COMMA_SEGMENT',
            subLocality: segmentParent.parentCity,
            resolvedCity: segmentParent.parentCity,
            postalCode: null,
            normalizedInput,
          };
        }
      }
    }

    // No DB match (candidate for expansion market)
    const fallbackSubLocality = trimmed.includes(',')
      ? trimmed.split(',')[0].trim()
      : trimmed;

    return {
      matched: false,
      matchPriority: 'NONE',
      subLocality: fallbackSubLocality || trimmed,
      resolvedCity: null,
      postalCode: null,
      normalizedInput,
    };
  }

  /**
   * Single-shot fast-forward router once serviceIntent is known:
   * skips satisfied qualifiers and locality if already provided.
   */
  determineNextStage1Step(
    metadata: VerticalMetadataConfig | null | undefined,
    collectedData: CollectedData & { intent?: string; locality?: string },
  ): Stage1NextStepDecision {
    const activeIntent = collectedData.serviceIntent || collectedData.intent;
    const pendingQualifier = this.getNextPendingQualifier(
      metadata,
      activeIntent,
      collectedData.verticalAttributes,
    );

    if (pendingQualifier) {
      return {
        nextState: 'VERTICAL_QUALIFIER_PENDING',
        pendingQualifier,
      };
    }

    const hasLocality = Boolean(
      collectedData.subLocality ||
        collectedData.resolvedCity ||
        collectedData.postalCode ||
        collectedData.locality,
    );

    if (!hasLocality) {
      return { nextState: 'LOCALITY_PENDING' };
    }

    return { nextState: 'READY_FOR_VENDORS' };
  }

  private findByNameOrAlias(
    normalizedTerm: string,
    nodes: Stage1LocalityNode[],
  ): Stage1LocalityNode | undefined {
    return nodes.find((node) => {
      if (this.normalize(node.name) === normalizedTerm) return true;
      if (
        Array.isArray(node.aliases) &&
        node.aliases.some((alias) => this.normalize(alias) === normalizedTerm)
      ) {
        return true;
      }
      return false;
    });
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}