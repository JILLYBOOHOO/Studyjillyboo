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
  | 'Gmail'
  | 'Smart Note';

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

export type VideoMomentCategory =
  | 'Key Point'
  | 'Tip / Warning'
  | 'Code Shown'
  | 'Action Item'
  | 'Name Mentioned'
  | 'Concept';

export interface StudentNameMention {
  timestamp: string;
  startSeconds: number;
  context: string;
  reason: string;
}

export interface VideoClassifiedMoment {
  timestamp: string;
  startSeconds: number;
  endSeconds: number;
  category: VideoMomentCategory;
  title: string;
  summary: string;
  codeSnippet?: string;
  codeLanguage?: string;
  screenshotNeeded?: boolean;
}

export interface VideoScreenshotItem {
  index: number;
  timestamp: string;
  seconds: number;
  category: VideoMomentCategory;
  caption: string;
  imageUrl: string;
  codeSnippet?: string;
  codeLanguage?: string;
}

export interface VideoMediaStats {
  originalSizeMb: number;
  compressedSizeMb: number;
  durationSeconds: number;
  durationFormatted: string;
  wasCompressed: boolean;
  isAudioOnly: boolean;
}

export interface VideoSessionResult {
  sessionId: string;
  videoStats: VideoMediaStats;
  screenshots: VideoScreenshotItem[];
  lecture: Omit<LectureAnalysis, 'id' | 'createdAt'>;
  savedLectureId?: string;
}

export interface VideoAskResponse {
  answer: string;
  timestampRefs: Array<{
    timestamp: string;
    seconds: number;
    note: string;
  }>;
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
  studentNameMentions?: StudentNameMention[];
  classifiedMoments?: VideoClassifiedMoment[];
  tipsAndWarnings?: string[];
  fullTranscript?: string;
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

export interface CalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  htmlLink?: string;
  isAllDay?: boolean;
}

export interface GoogleDocSummary {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink?: string;
}

export interface GoogleDocContent {
  documentId: string;
  title: string;
  plainText: string;
  revisionId?: string;
  webViewLink?: string;
}

export type SmartNoteCardType = 'code' | 'checklist' | 'note' | 'flashcard' | 'template';
export type SmartNoteColorTag = 'slate' | 'blue' | 'amber' | 'emerald' | 'rose';

export interface SmartNoteCodeSettings {
  theme: 'dark' | 'light';
  showLineNumbers: boolean;
  wordWrap: boolean;
  fontSize: 'sm' | 'md' | 'lg';
}

export interface SmartNoteChecklistItem {
  text: string;
  done: boolean;
}

export interface SmartNoteCard {
  id: string;
  courseCode: string;
  title: string;
  cardType: SmartNoteCardType;
  colorTag: SmartNoteColorTag;
  pinned: boolean;
  content: string;
  codeLanguage: string;
  codeSettings: SmartNoteCodeSettings;
  checklistItems: SmartNoteChecklistItem[];
  keywords: string[];
  reminderAt: string;
  sourceLabel: string;
  emailSubject?: string;
  flashcardHint?: string;
  createdAt: string;
}

export type SmartActionIntent =
  | 'date_reminder'
  | 'email_letter'
  | 'definition_flashcard'
  | 'code_snippet'
  | 'checklist_tasks'
  | 'study_note';

export interface SmartClipActionOption {
  actionId:
    | 'set_reminder'
    | 'add_classwork'
    | 'open_calendar'
    | 'send_email'
    | 'save_template'
    | 'save_flashcard'
    | 'practice_coach'
    | 'save_code'
    | 'save_checklist'
    | 'save_note';
  label: string;
  description: string;
}

export interface SmartClipAnalysis {
  handoffId?: string;
  extractedText: string;
  intent: SmartActionIntent;
  intentSummary: string;
  detectedDateIso: string;
  reminderTitle: string;
  emailSubject: string;
  emailTo: string;
  emailBody: string;
  flashcardFront: string;
  flashcardBack: string;
  flashcardHint: string;
  smartCard: Omit<SmartNoteCard, 'id' | 'createdAt'>;
  recommendedActions: SmartClipActionOption[];
}

export interface PodcastTurn {
  speaker: 'Alex' | 'Sam';
  line: string;
}

export interface MindMapLeaf {
  label: string;
  detail: string;
}

export interface MindMapBranch {
  title: string;
  summary: string;
  courseCode: string;
  children: MindMapLeaf[];
}

export interface MindMapData {
  rootTitle: string;
  rootSummary: string;
  branches: MindMapBranch[];
}

export interface StudioFlashcard {
  id: string;
  front: string;
  back: string;
  hint: string;
  courseCode: string;
}

export interface NotebookStudioBundle {
  briefingTitle: string;
  briefingSummary: string;
  podcastDialogue: PodcastTurn[];
  mindMap: MindMapData;
  flashcards: StudioFlashcard[];
}

