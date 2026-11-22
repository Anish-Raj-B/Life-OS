/** Domain types mirroring the SQL schema in supabase/migrations. */

export type UUID = string;
export type ISODate = string;
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled';
export type Provider = 'github' | 'leetcode' | 'picoctf';

export interface BaseRow {
  id: UUID;
  user_id: UUID;
  created_at: ISODate;
  updated_at?: ISODate;
  version?: number;
}

export interface Profile {
  id: UUID;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  current_role: string | null;
  career_objective: string | null;
  long_term_ambition: string | null;
  short_term_goals: string | null;
  interests: string[];
  skills: string[];
  technologies: string[];
  current_projects: string | null;
  learning_priorities: string | null;
  career_direction: string | null;
  target_achievements: string | null;
  links: { label: string; url: string }[];
  github_url: string | null;
  leetcode_url: string | null;
  picoctf_url: string | null;
  portfolio_url: string | null;
  timezone: string;
  onboarded: boolean;
  suspended: boolean;
  created_at: ISODate;
  updated_at: ISODate;
  version: number;
}

export interface PlatformSettings {
  id: number;
  public_registration_enabled: boolean;
  app_name: string;
  announcement: string | null;
  theme: {
    accent?: string;
    accent2?: string;
    base?: string;
    surface?: string;
    radius?: string;
    fontSans?: string;
    mode?: string;
  };
  navigation: NavItem[];
  dashboard_layout: string[];
  modules: Record<string, boolean>;
  defaults: {
    timetable_start?: string;
    timetable_end?: string;
    week_starts_on?: number;
    timezone?: string;
  };
  updated_at: ISODate;
}

export interface NavItem {
  key: string;
  label: string;
  path: string;
  adminOnly?: boolean;
}

export interface UserSettings {
  user_id: UUID;
  notifications: Record<string, boolean>;
  week_starts_on: number;
  timetable_start: string;
  timetable_end: string;
}

export interface Section extends BaseRow {
  name: string;
  description: string | null;
  icon: string;
  color: string | null;
  sort_order: number;
  archived: boolean;
}

export interface Topic extends BaseRow {
  section_id: UUID;
  name: string;
  description: string | null;
  sort_order: number;
}

export interface Task extends BaseRow {
  title: string;
  description: string | null;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  reminder_at: ISODate | null;
  completed_at: ISODate | null;
  section_id: UUID | null;
  topic_id: UUID | null;
  category_id: UUID | null;
  tags: string[];
  links: { label: string; url: string }[];
  sort_order: number;
  deleted_at: ISODate | null;
}

export interface TaskCategory extends BaseRow {
  name: string;
  color: string;
}

export interface TimetableEntry extends BaseRow {
  day_date: string;
  start_time: string;
  end_time: string;
  title: string;
  description: string | null;
  task_id: UUID | null;
  section_id: UUID | null;
  reminder_at: ISODate | null;
  recurrence: { type: 'none' | 'daily' | 'weekly'; until?: string };
  sort_order: number;
  deleted_at: ISODate | null;
}

export interface LearningRecord extends BaseRow {
  section_id: UUID | null;
  topic_id: UUID | null;
  title: string;
  record_date: string;
  notes_md: string | null;
  learned: string | null;
  key_concepts: string | null;
  practice: string | null;
  understood: string | null;
  not_understood: string | null;
  mistakes: string | null;
  next_steps: string | null;
  resources: { label: string; url: string }[];
  attachments: { name: string; url: string }[];
  tags: string[];
  duration_minutes: number | null;
  deleted_at: ISODate | null;
}

export interface LearningResource extends BaseRow {
  section_id: UUID | null;
  topic_id: UUID | null;
  title: string;
  url: string;
  description: string | null;
  notes: string | null;
  tags: string[];
  deleted_at: ISODate | null;
}

export interface LearningPath extends BaseRow {
  name: string;
  start_date: string;
  end_date: string | null;
  status: 'active' | 'complete' | 'broken';
  is_current: boolean;
}

export interface LearningPathNode extends BaseRow {
  path_id: UUID;
  seq_number: number;
  node_date: string;
  verified: boolean;
  verification_source: 'none' | 'manual' | 'auto';
  note: string | null;
}

export interface DailyProgress extends BaseRow {
  node_id: UUID;
  stage: 1 | 2 | 3;
  evidence: string | null;
  completed_at: ISODate;
}

export interface StreakHistory {
  id: UUID;
  user_id: UUID;
  path_id: UUID;
  start_date: string;
  end_date: string;
  days_count: number;
  stages_completed: number;
  broken_at: ISODate;
}

export interface FlashcardDeck extends BaseRow {
  section_id: UUID | null;
  topic_id: UUID | null;
  name: string;
  description: string | null;
  deleted_at: ISODate | null;
}

export interface Flashcard extends BaseRow {
  deck_id: UUID;
  question: string;
  answer: string;
  explanation: string | null;
  reference_url: string | null;
  tags: string[];
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  due_date: string;
  last_reviewed_at: ISODate | null;
  state: 'new' | 'learning' | 'review' | 'difficult';
  deleted_at: ISODate | null;
}

export interface FlashcardReview extends BaseRow {
  card_id: UUID;
  rating: number;
  remembered: boolean;
  difficult: boolean;
  interval_before: number | null;
  interval_after: number | null;
  ease_after: number | null;
  reviewed_at: ISODate;
}

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'scenario'
  | 'conceptual'
  | 'practical';

export interface QuestionBankItem extends BaseRow {
  section_id: UUID | null;
  topic_id: UUID | null;
  type: QuestionType;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string | null;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  source: 'manual' | 'flashcard' | 'ai';
}

export interface Challenge extends BaseRow {
  title: string;
  section_id: UUID | null;
  topic_ids: UUID[];
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'mixed';
  question_count: number;
  source: 'bank' | 'ai' | 'manual';
}

export interface ChallengeQuestion extends BaseRow {
  challenge_id: UUID;
  topic_id: UUID | null;
  position: number;
  type: QuestionType;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string | null;
  difficulty: string;
}

export interface ChallengeAttempt extends BaseRow {
  challenge_id: UUID;
  started_at: ISODate;
  completed_at: ISODate | null;
  score: number;
  total: number;
  duration_seconds: number | null;
  topic_breakdown: { topic_id: string | null; correct: number; total: number }[];
}

export interface ChallengeAnswer extends BaseRow {
  attempt_id: UUID;
  question_id: UUID | null;
  answer: string | null;
  is_correct: boolean;
  time_seconds: number | null;
}

export interface DiaryEntry extends BaseRow {
  entry_date: string;
  title: string | null;
  content_md: string;
  mood: number | null;
  tags: string[];
  links: { label: string; url: string }[];
  deleted_at: ISODate | null;
}

export interface Goal extends BaseRow {
  name: string;
  description: string | null;
  category: string | null;
  start_date: string | null;
  target_date: string | null;
  progress: number;
  status: 'active' | 'completed' | 'paused' | 'abandoned';
}

export interface Milestone extends BaseRow {
  goal_id: UUID;
  title: string;
  due_date: string | null;
  completed_at: ISODate | null;
  sort_order: number;
  created_at: ISODate;
}

export interface IntegrationAccount {
  id: UUID;
  user_id: UUID;
  provider: Provider;
  external_username: string | null;
  external_user_id: string | null;
  status: 'connected' | 'error' | 'disconnected';
  scopes: string[];
  metadata: Record<string, any>;
  last_synced_at: ISODate | null;
  last_error: string | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface IntegrationActivity {
  id: UUID;
  user_id: UUID;
  provider: Provider;
  activity_date: string;
  kind: string;
  count: number;
  details: Record<string, any>;
  external_id: string | null;
  source: 'api' | 'manual';
  verified: boolean;
  created_at: ISODate;
}

export interface IntegrationSyncLog {
  id: UUID;
  user_id: UUID;
  provider: string;
  status: 'success' | 'error';
  message: string | null;
  created_at: ISODate;
}

export interface Notification {
  id: UUID;
  user_id: UUID;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  read_at: ISODate | null;
  scheduled_at: ISODate;
  created_at: ISODate;
}

export interface AuditLog {
  id: UUID;
  actor_id: UUID | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, any>;
  created_at: ISODate;
}
