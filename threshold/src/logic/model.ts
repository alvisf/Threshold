// Data model. Field names follow the Threshold brief (snake_case) so exports match the spec.
export const DATA_VERSION = 1;

export type Hydration = 'low' | 'ok' | 'good';
export type Caffeine = 'less' | 'usual' | 'more';
export type Stress = 'calm' | 'stressed' | 'excited';
export type CyclePhase = 'pre_period' | 'period' | 'ovulation' | 'other';
export type ProdromeSign = 'yawning' | 'neck_stiffness' | 'fatigue_fog' | 'light_sound' | 'urination_mood';
export type Classification = 'PRODROME_CRAVING' | 'PRODROME_SIGNS' | 'CANDIDATE_TRIGGER';
export type EventContext = 'log' | 'challenge';
export type PainSide = 'left' | 'right' | 'both' | 'back';
export type DosePhase = 'PRODROME' | 'HEADACHE';
export type EpisodeStatus = 'prodrome' | 'active' | 'ended' | 'averted';
export type BlockKind = 'excitement' | 'stress' | 'focus';
export type Intensity = 1 | 2 | 3;
export type ChallengeStatus = 'active' | 'passed' | 'failed' | 'cancelled';

export interface UserProfile {
  user_id: string;
  baseline_wake_time: string;
  baseline_caffeine_mg: number;
  menstrual_tracking_enabled: boolean;
  suspect_items: string[];
  medications: string[];
  rescue_plan: string[];
  pressure_enabled: boolean;
  location: { lat: number; lon: number } | null;
  notifications_enabled: boolean;
}

export interface DailyBucketLog {
  log_id: string;
  date: string;
  checked_in: boolean;
  sleep_hours: number | null;
  wake_time: string | null;
  wake_time_delta_minutes: number | null;
  skipped_meal_flag: boolean;
  hydration_level: Hydration | null;
  caffeine_variance: Caffeine | null;
  stress_state: Stress | null;
  cycle_phase: CyclePhase | null;
  barometric_delta_hpa: number | null;
  pressure_at: number | null;
  calculated_bucket_score: number;
  updated_at: number;
}

export interface FoodAndCravingEvent {
  event_id: string;
  timestamp: string;
  item_name: string;
  was_strong_craving: boolean;
  accompanying_prodrome_signs: ProdromeSign[];
  classification: Classification;
  context: EventContext;
}

export interface MedicationDose {
  drug_name: string;
  taken_at: string;
  taken_during_phase: DosePhase;
  headache_aborted: boolean | null;
}

export interface MigraineEpisode {
  episode_id: string;
  status: EpisodeStatus;
  prodrome_detected_at: string | null;
  headache_onset_at: string | null;
  ended_at: string | null;
  peak_pain_score: number;
  pain_location: PainSide[];
  masked_by_fun_or_adrenaline: boolean;
  medications_taken: MedicationDose[];
}

export interface EngagementBlock {
  block_id: string;
  kind: BlockKind;
  intensity: Intensity;
  started_at: string;
  ended_at: string | null;
  letdown_window_ends_at: string | null;
  decompression_done: string[];
}

export interface CalmDayChallenge {
  challenge_id: string;
  item_name: string;
  started_at: string;
  status: ChallengeStatus;
  resolved_at: string | null;
}

export interface AppData {
  daily: DailyBucketLog[];
  events: FoodAndCravingEvent[];
  episodes: MigraineEpisode[];
  blocks: EngagementBlock[];
  challenges: CalmDayChallenge[];
}

export const EMPTY_DATA: AppData = { daily: [], events: [], episodes: [], blocks: [], challenges: [] };

export const DEFAULT_SUSPECTS = [
  'chocolate', 'sweets', 'salty_snacks', 'carb_heavy_meal', 'afternoon_caffeine', 'red_wine', 'aged_cheese', 'citrus',
];

export const DEFAULT_RESCUE_PLAN = [
  'Take my rescue medicine, if prescribed',
  'Drink a big glass of water',
  'Eat a protein snack',
  'Dim the lights and rest',
];

export const SIGNS: { id: ProdromeSign; label: string }[] = [
  { id: 'yawning', label: 'Yawning' },
  { id: 'neck_stiffness', label: 'Stiff neck' },
  { id: 'fatigue_fog', label: 'Tired or foggy' },
  { id: 'light_sound', label: 'Light or sound bothers me' },
  { id: 'urination_mood', label: 'Peeing a lot or low mood' },
];

export const PAIN_SIDES: { id: PainSide; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'both', label: 'Both' },
  { id: 'back', label: 'Back of head' },
];
