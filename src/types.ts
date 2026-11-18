export type ClassworkType =
  | 'Assignment'
  | 'Lab'
  | 'Quiz'
  | 'Module Reading'
  | 'Lecture Catch-Up'
  | 'Project';

export type ClassworkStatus =
  | 'Urgent Catch-Up'
  | 'In Progress'
  | 'Upcoming'
  | 'Completed';

export type ClassworkSource =
  | 'Manual'
  | 'Zoom Transcript'
  | 'Zoom Recording'
  | 'Module File'
  | 'Gmail';

export interface Course {
  id: string;
  code: string;
  title: string;
  lecturer: string;
  semester: string;
}

export interface ClassworkItem {
  id: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  type: ClassworkType;
  status: ClassworkStatus;
  dueDate: string;
  estimatedMinutes: number;
  source: ClassworkSource;
  notes: string;
  createdAt: string;
}

export interface LectureConcept {
  term: string;
  simpleExplanation: string;
  analogyOrExample: string;
}

export interface LectureActionItem {
  title: string;
  type: ClassworkType;
  dueHint: string;
  estimatedMinutes: number;
  addedToTracker?: boolean;
}

export interface LectureQuestion {
  question: string;
  answer: string;
}

export interface LectureAnalysis {
  id: string;
  courseCode: string;
  moduleTopic: string;
  keywords: string[];
  title: string;
  lectureDate: string;
  sourceType: 'Transcript' | 'Recording';
  fileName: string;
  durationOrLines: string;
  plainEnglishSummary: string;
  keyConcepts: LectureConcept[];
  actionItems: LectureActionItem[];
  checkQuestions: LectureQuestion[];
  rawExcerpt: string;
  createdAt: string;
}

export interface ModuleTopicBreakdown {
  topic: string;
  plainEnglish: string;
  keyTakeaway: string;
  exampleOrCode: string;
}

export interface ModuleGuide {
  id: string;
  courseCode: string;
  moduleTopic: string;
  keywords: string[];
  title: string;
  fileName: string;
  overview: string;
  learningObjectives: string[];
  topicBreakdowns: ModuleTopicBreakdown[];
  difficultyNote: string;
  extractedTextPreview: string;
  createdAt: string;
}

export interface SprintStep {
  order: number;
  taskId?: string;
  title: string;
  courseCode: string;
  durationMinutes: number;
  reason: string;
  strategyTip: string;
  completed: boolean;
}

export interface CatchUpSprint {
  id: string;
  generatedAt: string;
  hoursAvailable: number;
  focusMessage: string;
  steps: SprintStep[];
}

export interface LinkedMaterialRef {
  kind: 'lecture' | 'module' | 'task' | 'email';
  targetId: string;
  label: string;
}

export interface CourseProgressSummary {
  courseCode: string;
  courseTitle: string;
  statusLabel: 'On Track' | 'Catching Up' | 'Needs Focus';
  completedCount: number;
  openCount: number;
  behindAreas: string[];
}

export interface PrioritizedCatchUpTopic {
  priorityRank: number;
  urgency: 'Critical' | 'High' | 'Medium';
  courseCode: string;
  topic: string;
  whyBehind: string;
  recommendedAction: string;
  estimatedMinutes: number;
  linkedMaterials: LinkedMaterialRef[];
}

export interface ProgressReport {
  id: string;
  createdAt: string;
  overallStatusSummary: string;
  analyzedEmailCount: number;
  courseProgress: CourseProgressSummary[];
  prioritizedTopics: PrioritizedCatchUpTopic[];
}

export type TutorMode = 'qa' | 'socratic';

export type SocraticEvaluationStatus = 'question' | 'retry' | 'mastered';

export interface TutorCitation {
  kind: 'lecture' | 'module' | 'email';
  id: string;
  title: string;
  courseCode: string;
}

export interface TutorMessage {
  role: 'user' | 'assistant';
  text: string;
  citations?: TutorCitation[];
  evaluationStatus?: SocraticEvaluationStatus;
  conceptFocus?: string;
  hintText?: string;
}

export interface TutorThread {
  id: string;
  mode: TutorMode;
  focusCourse: string;
  masteredConcepts: string[];
  title: string;
  messages: TutorMessage[];
  createdAt: string;
}

export type QuizDifficulty = 'Review' | 'Standard' | 'Challenge';
export type QuizQuestionType = 'mcq' | 'short';

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options?: string[];
  correctOptionIndex?: number;
  modelAnswer: string;
  explanation: string;
  conceptFocus: string;
  courseCode: string;
  sourceTitle: string;
}

export interface QuizAnswerRecord {
  questionId: string;
  selectedOptionIndex?: number;
  textResponse?: string;
  isCorrect: boolean;
  status: 'correct' | 'partial' | 'incorrect';
  feedback: string;
  attempts: number;
}

export interface InteractiveQuiz {
  id: string;
  title: string;
  courseCode: string;
  topicFocus: string;
  difficulty: QuizDifficulty;
  questions: QuizQuestion[];
  answers: QuizAnswerRecord[];
  score: number;
  totalQuestions: number;
  completed: boolean;
  createdAt: string;
}

export interface EmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  bodyText: string;
}

export interface ExtractedEmailAction {
  title: string;
  type: ClassworkType;
  courseCode: string;
  dueDate: string;
  estimatedMinutes: number;
  notes: string;
  addedToTracker?: boolean;
}

export interface ExtractedEmailWork {
  summary: string;
  urgency: 'High' | 'Medium' | 'Low';
  zoomLinks: string[];
  actionItems: ExtractedEmailAction[];
}
