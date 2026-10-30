import type { Classification, EventContext, FoodAndCravingEvent, ProdromeSign } from './model';
import { toIso, uid } from './time';

/**
 * Prodrome Micro-Check routing.
 * Any prodrome sign means the migraine had already started, so the food is not blamed.
 * The urge only decides the wording. No signs: the food is a candidate trigger, watched for 24 h.
 */
export function classify(suddenUrge: boolean, signs: readonly ProdromeSign[]): Classification {
  if (signs.length > 0) return suddenUrge ? 'PRODROME_CRAVING' : 'PRODROME_SIGNS';
  return 'CANDIDATE_TRIGGER';
}

export const isProdrome = (c: Classification) => c !== 'CANDIDATE_TRIGGER';

export const RESULT: Record<Classification, { title: string; text: string }> = {
  PRODROME_CRAVING: {
    title: 'Prodrome craving',
    text: 'Your migraine likely started 1-3 hours ago. Enjoy the snack guilt-free and take your rescue steps now.',
  },
  PRODROME_SIGNS: {
    title: 'Prodrome signs',
    text: 'A migraine may have started. The food is not blamed. Take your rescue steps now.',
  },
  CANDIDATE_TRIGGER: {
    title: 'Logged',
    text: "We'll watch the next 24 hours.",
  },
};

export function makeEvent(args: {
  item: string; suddenUrge: boolean; signs: readonly ProdromeSign[]; context?: EventContext; now: number;
}): FoodAndCravingEvent {
  return {
    event_id: uid(),
    timestamp: toIso(args.now),
    item_name: args.item,
    was_strong_craving: args.suddenUrge,
    accompanying_prodrome_signs: [...args.signs],
    classification: classify(args.suddenUrge, args.signs),
    context: args.context ?? 'log',
  };
}
