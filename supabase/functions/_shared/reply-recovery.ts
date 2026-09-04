import type { ReplyAnswerability } from './reply-answerability.ts';

export type ReplyRecoveryStrategy =
  | 'conservative_grounding_reset'
  | 'deterministic_placeholder_fallback'
  | 'minimal_contextual_reply'
  | 'omit_ocr_noise'
  | 'omit_unsupported_name'
  | 'preserve_fact_ownership'
  | 'remove_unsupported_me_fact'
  | 'restore_me_perspective'
  | 'restore_selected_tone'
  | 'restore_structured_output'
  | 'restore_target_language'
  | 'use_descriptive_placeholder';

export type ReplyRecoverySelection = {
  previouslyFailedStrategyAvoided: boolean;
  strategy: ReplyRecoveryStrategy;
};

function getPreferredRecoveryStrategy(
  rejectionCodes: readonly string[],
  answerability: ReplyAnswerability,
): ReplyRecoveryStrategy {
  if (
    rejectionCodes.includes('unsupported_me_fact') &&
    answerability.answerability === 'requires_user_knowledge' &&
    answerability.placeholderAllowed
  ) {
    return 'use_descriptive_placeholder';
  }

  if (rejectionCodes.includes('fact_owner_reversal')) return 'preserve_fact_ownership';
  if (rejectionCodes.includes('unsupported_me_fact')) return 'remove_unsupported_me_fact';
  if (rejectionCodes.includes('unsupported_name')) return 'omit_unsupported_name';
  if (rejectionCodes.includes('ocr_noise')) return 'omit_ocr_noise';
  if (rejectionCodes.includes('wrong_speaker')) return 'restore_me_perspective';
  if (rejectionCodes.includes('wrong_language')) return 'restore_target_language';
  if (rejectionCodes.includes('structured_output_invalid')) return 'restore_structured_output';
  if (rejectionCodes.includes('missing_selected_tone')) return 'restore_selected_tone';

  return 'conservative_grounding_reset';
}

export function selectReplyRecoveryStrategy(
  rejectionCodes: readonly string[],
  answerability: ReplyAnswerability,
  failedStrategies: readonly ReplyRecoveryStrategy[] = [],
): ReplyRecoverySelection {
  const preferredStrategy = getPreferredRecoveryStrategy(rejectionCodes, answerability);

  if (!failedStrategies.includes(preferredStrategy)) {
    return {
      previouslyFailedStrategyAvoided: false,
      strategy: preferredStrategy,
    };
  }

  return {
    previouslyFailedStrategyAvoided: true,
    strategy: preferredStrategy === 'use_descriptive_placeholder'
      ? 'deterministic_placeholder_fallback'
      : 'minimal_contextual_reply',
  };
}

export function getReplyRecoveryInstructions(
  rejectionCodes: readonly string[],
  answerability: ReplyAnswerability,
  selection: ReplyRecoverySelection,
) {
  const instructions: string[] = [
    `- Selected recovery strategy: ${selection.strategy}.`,
  ];

  if (selection.previouslyFailedStrategyAvoided) {
    instructions.push(
      '- A previous recovery strategy failed validation. Do not repeat or paraphrase that approach; use the selected fresh strategy.',
    );
  }

  if (rejectionCodes.includes('unsupported_me_fact')) {
    instructions.push(
      answerability.answerability === 'requires_user_knowledge' && answerability.placeholder
        ? `- The answer requires user knowledge. Use exactly the allowed editable slot ${answerability.placeholder}; do not supply a concrete value.`
        : '- Remove unsupported first-person facts. State only facts established for ME in the transcript or userFacts.',
    );
  }

  if (rejectionCodes.includes('fact_owner_reversal')) {
    instructions.push('- Keep THEM facts owned by THEM. Do not transfer their facts, activities, possessions, or preferences to ME.');
  }

  if (rejectionCodes.includes('unsupported_name')) {
    instructions.push('- Omit the unsupported name entirely. Do not replace it with another name.');
  }

  if (rejectionCodes.includes('ocr_noise')) {
    instructions.push('- Omit every suspicious OCR-like token and respond only to the clear conversational context.');
  }

  if (rejectionCodes.includes('wrong_speaker')) {
    instructions.push('- Write only from ME’s perspective as a message ME can send to THEM.');
  }

  if (rejectionCodes.includes('wrong_language')) {
    instructions.push('- Rewrite in the required target language without changing fact ownership.');
  }

  if (rejectionCodes.includes('structured_output_invalid')) {
    instructions.push('- Return the required structured reply batch exactly.');
  }

  if (rejectionCodes.includes('missing_selected_tone')) {
    instructions.push('- Include exactly one reply for every requested tone and match each tone bucket.');
  }

  if (selection.strategy === 'minimal_contextual_reply') {
    instructions.push(
      '- Use a fresh, short reply anchored to the latest clear THEM message. Omit the risky detail instead of retrying the failed construction.',
    );
  }

  return instructions;
}
