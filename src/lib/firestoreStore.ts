import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from './firebaseClient';

const HEART_AMBER_PROGRAM_LABEL = 'Associate Degree in Artificial Intelligence';

const HEART_AMBER_COURSES = [
  { id: 'ail1001', code: 'AIL1001', title: 'Introduction to Artificial Intelligence', lecturer: 'B.C. Rajesh', semester: 'Semester 1' },
  { id: 'ail1002', code: 'AIL1002', title: 'Programming I (Python)', lecturer: 'B.M. Rajesh', semester: 'Semester 1' },
  { id: 'ail1003', code: 'AIL1003', title: 'Discrete Mathematics', lecturer: 'B.C. Rajesh & B.M. Rajesh', semester: 'Semester 1' },
  { id: 'stat101', code: 'STAT101', title: 'Statistics & Probability', lecturer: 'Faculty', semester: 'Semester 1' },
  { id: 'ail1004', code: 'AIL1004', title: 'Communication Skills for Engineers', lecturer: 'S. Moffatt', semester: 'Semester 1' },
  { id: 'eth101', code: 'ETH101', title: 'AI Law & Ethics', lecturer: 'S. Moffatt', semester: 'Semester 1' },
  { id: 'agd101', code: 'AGD101', title: 'Agentic Development', lecturer: 'B.C. Rajesh & B.M. Rajesh', semester: 'Semester 1' },
  { id: 'dsa101', code: 'DSA101', title: 'Data Structures & AI Project Work Labs', lecturer: 'J. Burrowes', semester: 'Semester 1' },
];

const HEART_STARTER_TASKS = [
  {
    id: 'task_starter_py',
    courseCode: 'AIL1002',
    courseTitle: 'Programming I (Python)',
    title: 'Complete Python File Handling & CSV Lab Review',
    type: 'Lab' as const,
    status: 'Urgent Catch-Up' as const,
    dueDate: '2026-12-03',
    estimatedMinutes: 60,
    source: 'Module File' as const,
    notes: 'Focus on functions, file handling, NumPy arrays, and Pandas DataFrames.',
  },
  {
    id: 'task_starter_nlp',
    courseCode: 'AIL1001',
    courseTitle: 'Introduction to Artificial Intelligence',
    title: 'Review NLP Tokenization & Transformer Pipeline',
    type: 'Lecture Catch-Up' as const,
    status: 'In Progress' as const,
    dueDate: '2026-12-04',
    estimatedMinutes: 45,
    source: 'Zoom Transcript' as const,
    notes: 'Review tokenization, stemming vs. lemmatization, NER, and BERT concepts.',
  },
];
import type {
  CatchUpSprint,
  ClassworkItem,
  ClassworkStatus,
  Course,
  InteractiveQuiz,
  LectureAnalysis,
  ModuleGuide,
  ProgressReport,
  QuizAnswerRecord,
  SmartNoteCard,
  SmartNoteCodeSettings,
  TutorMessage,
  TutorMode,
  TutorThread,
} from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function clampStr(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const cleaned = String(val ?? fallback).trim();
  return cleaned.slice(0, maxLen);
}

function clampKeywords(list: string[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((k) => clampStr(k, 40, ''))
    .filter(Boolean)
    .slice(0, 12);
}

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export async function ensureUserProfileAndSeed(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: clampStr(user.displayName || 'AI Student', 120, 'AI Student'),
        program: clampStr(HEART_AMBER_PROGRAM_LABEL, 160, 'Associate Degree in AI'),
        starterSeeded: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await seedStarterWorkspace(user.uid);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncAmberHeartCurriculumDoc(uid: string): Promise<{
  coursesAdded: number;
  coursesUpdated: number;
  tasksAdded: number;
}> {
  let coursesAdded = 0;
  let coursesUpdated = 0;
  let tasksAdded = 0;

  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        program: clampStr(HEART_AMBER_PROGRAM_LABEL, 160, 'Associate Degree in AI'),
        updatedAt: serverTimestamp(),
      });
    }

    const [existingCoursesSnap, existingTasksSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'courses'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'tasks'), where('ownerId', '==', uid))),
    ]);

    const existingCourseById = new Map<string, string>();
    const existingCourseByCode = new Map<string, string>();
    for (const d of existingCoursesSnap.docs) {
      existingCourseById.set(d.id, d.id);
      const code = String(d.data().code || '').trim().toUpperCase();
      if (code) existingCourseByCode.set(code, d.id);
    }

    const existingTaskIds = new Set(existingTasksSnap.docs.map((d) => d.id));
    const existingTaskTitles = new Set(
      existingTasksSnap.docs.map((d) => String(d.data().title || '').trim().toLowerCase()),
    );

    const batch = writeBatch(db);

    for (const c of HEART_AMBER_COURSES) {
      const targetId =
        existingCourseById.get(c.id) || existingCourseByCode.get(c.code.toUpperCase()) || null;
      const payload = {
        code: clampStr(c.code, 24, 'COURSE'),
        title: clampStr(c.title, 160, 'Course'),
        lecturer: clampStr(c.lecturer, 120, 'TBA'),
        semester: clampStr(c.semester, 120, 'HEART/NSTA Amber Academy'),
      };

      if (targetId) {
        batch.update(doc(db, 'users', uid, 'courses', targetId), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        coursesUpdated++;
      } else {
        batch.set(doc(db, 'users', uid, 'courses', c.id), {
          ownerId: uid,
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        coursesAdded++;
      }
    }

    for (const t of HEART_STARTER_TASKS) {
      if (existingTaskIds.has(t.id) || existingTaskTitles.has(t.title.trim().toLowerCase())) {
        continue;
      }
      batch.set(doc(db, 'users', uid, 'tasks', t.id), {
        ownerId: uid,
        courseCode: clampStr(t.courseCode, 24, 'AIL1001'),
        courseTitle: clampStr(t.courseTitle, 160, 'AI Associate Degree'),
        title: clampStr(t.title, 240, 'Classwork Task'),
        type: t.type,
        status: t.status,
        dueDate: clampStr(t.dueDate, 32, 'TBD'),
        estimatedMinutes: Math.max(1, Math.min(600, Math.round(t.estimatedMinutes))),
        source: t.source,
        notes: clampStr(t.notes, 2000, ''),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tasksAdded++;
    }

    await batch.commit();
    return { coursesAdded, coursesUpdated, tasksAdded };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function seedStarterWorkspace(uid: string): Promise<void> {
  try {
    await syncAmberHeartCurriculumDoc(uid);

    const [existingLecturesSnap, existingModulesSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'lectures'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'modules'), where('ownerId', '==', uid))),
    ]);

    const existingLecIds = new Set(existingLecturesSnap.docs.map((d) => d.id));
    const existingModIds = new Set(existingModulesSnap.docs.map((d) => d.id));

    const batch = writeBatch(db);
    let hasWrites = false;

    if (!existingLecIds.has('lec_starter_amber_1')) {
      hasWrites = true;
      batch.set(doc(db, 'users', uid, 'lectures', 'lec_starter_amber_1'), {
        ownerId: uid,
        courseCode: 'AIL1001',
        moduleTopic: 'Phase 3 · NLP (Weeks 17–20) & Supervised Learning',
        keywords: [
          'tokenization',
          'stemming',
          'lemmatization',
          'NER',
          'BERT',
          'supervised learning',
        ],
        title: 'NLP Foundations (Weeks 17–20): Tokenization, Embeddings & Chatbots',
        lectureDate: '2026-11-30',
        sourceType: 'Transcript',
        fileName: 'AIL1001_NLP_Weeks17_20_Sample.vtt',
        durationOrLines: 'Sample syllabus note',
        plainEnglishSummary:
          'Covers how machines clean raw human text and convert sentences into tokens, vectors, and meaning. Connects text preprocessing (cleaning, stemming, lemmatization, NER) to modern BERT encoders and conversational AI chatbots.',
        keyConcepts: [
          {
            term: 'Tokenization & Stemming vs. Lemmatization',
            simpleExplanation:
              'Tokenization splits sentences into pieces; stemming chops word endings quickly while lemmatization uses grammar rules to find the true dictionary root word.',
            analogyOrExample:
              'Stemming turns "running" and "studies" into "run" / "studi", whereas lemmatization cleanly gives "run" and "study".',
          },
          {
            term: 'Transformer Flow & Self-Attention',
            simpleExplanation:
              'Instead of reading one word at a time like older RNNs, Transformers inspect every word in a sentence together so the model knows which words relate.',
            analogyOrExample:
              'In "The bank by the river flooded", self-attention links "bank" strongly to "river" rather than money.',
          },
        ],
        actionItems: [
          {
            title: 'Review AIL1001 Introduction to AI & NLP Chatbot Pipeline before Friday Revision',
            type: 'Lecture Catch-Up',
            dueHint: 'Friday 8:30 AM Revision (B.C. Rajesh)',
            estimatedMinutes: 40,
            addedToTracker: false,
          },
        ],
        checkQuestions: [
          {
            question: 'Why do Transformers process text more accurately over long sentences than older RNNs or LSTMs?',
            answer:
              'They use parallel processing and Multi-Head Self-Attention to connect distant words directly instead of passing memory sequentially step by step.',
          },
        ],
        rawExcerpt:
          'Starter syllabus guide aligned to your HEART/NSTA Amber Academy NLP (Weeks 17–20) and Transformer slides.',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (!existingModIds.has('mod_starter_amber_1')) {
      hasWrites = true;
      batch.set(doc(db, 'users', uid, 'modules', 'mod_starter_amber_1'), {
        ownerId: uid,
        courseCode: 'AIL1002',
        moduleTopic: 'Phase 1 · Python Foundations, File Handling & NumPy/Pandas',
        keywords: ['Python', 'file handling', 'CSV', 'NumPy', 'Pandas', 'Jupyter'],
        title: 'AIL1002 Programming I (Python): Core Foundations & Data Analysis',
        fileName: 'AIL1002_Python_Foundations_Guide.pdf',
        overview:
          'Focused revision guide for bringing Programming I (Python) from 50% to 100%, covering loops, functions, file handling, CSV reading, NumPy arrays, and Pandas DataFrames.',
        learningObjectives: [
          'Write clean Python functions, conditionals, and loops without syntax errors.',
          'Read and analyze CSV datasets safely using Python file handling and Pandas.',
          'Create NumPy arrays and check .shape before feeding data into ML models.',
        ],
        topicBreakdowns: [
          {
            topic: 'File Handling & CSV Analysis',
            plainEnglish:
              'Always open files using a "with open(...) as f:" block so Python closes the file automatically even if an error happens.',
            keyTakeaway: 'Use csv or pandas.read_csv() to turn raw spreadsheet text into structured tables.',
            exampleOrCode:
              "import pandas as pd\ndf = pd.read_csv('students.csv')\nprint(df.head())",
          },
          {
            topic: 'NumPy Arrays vs. Python Lists',
            plainEnglish:
              'NumPy packs numbers tightly in memory so you can calculate averages or scale entire columns in one fast operation.',
            keyTakeaway: 'Always inspect array.shape first—most beginner AI errors come from mismatched shapes.',
            exampleOrCode:
              'import numpy as np\nscores = np.array([72, 85, 90])\nprint(scores.mean(), scores.shape)',
          },
        ],
        difficultyNote:
          'Common hurdle before B.M. Rajesh Thursday revision: forgetting to return values from functions (printing instead of returning) and confusing list indexing with Pandas .loc/.iloc.',
        extractedTextPreview:
          'Starter guide aligned to HEART/NSTA Amber Academy Python Foundations (Variables, Conditionals, Loops & Functions, File Handling, NumPy, Pandas, CSV Reader, Student Record System).',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (hasWrites) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export function subscribeWorkspace(
  uid: string,
  callbacks: {
    onCourses: (courses: Course[]) => void;
    onTasks: (tasks: ClassworkItem[]) => void;
    onLectures: (lectures: LectureAnalysis[]) => void;
    onModules: (modules: ModuleGuide[]) => void;
    onSprint: (sprint: CatchUpSprint | null) => void;
    onProgressReport: (report: ProgressReport | null) => void;
    onTutorThreads: (threads: TutorThread[]) => void;
    onQuizzes: (quizzes: InteractiveQuiz[]) => void;
    onNotes: (notes: SmartNoteCard[]) => void;
    onError: (err: Error) => void;
  },
): () => void {
  const unsubCourses = onSnapshot(
    query(collection(db, 'users', uid, 'courses'), where('ownerId', '==', uid), orderBy('code', 'asc')),
    (snap) => {
      callbacks.onCourses(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            code: String(data.code || ''),
            title: String(data.title || ''),
            lecturer: String(data.lecturer || ''),
            semester: String(data.semester || ''),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/courses`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubTasks = onSnapshot(
    query(collection(db, 'users', uid, 'tasks'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
    (snap) => {
      callbacks.onTasks(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            courseCode: String(data.courseCode || ''),
            courseTitle: String(data.courseTitle || ''),
            title: String(data.title || ''),
            type: data.type,
            status: data.status,
            dueDate: String(data.dueDate || 'TBD'),
            estimatedMinutes: Number(data.estimatedMinutes || 30),
            source: data.source,
            notes: String(data.notes || ''),
            createdAt: timestampToIso(data.createdAt),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/tasks`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubLectures = onSnapshot(
    query(collection(db, 'users', uid, 'lectures'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
    (snap) => {
      callbacks.onLectures(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            courseCode: String(data.courseCode || ''),
            moduleTopic: String(data.moduleTopic || 'General Lecture'),
            keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
            title: String(data.title || ''),
            lectureDate: String(data.lectureDate || ''),
            sourceType: data.sourceType,
            fileName: String(data.fileName || ''),
            durationOrLines: String(data.durationOrLines || ''),
            plainEnglishSummary: String(data.plainEnglishSummary || ''),
            keyConcepts: Array.isArray(data.keyConcepts) ? data.keyConcepts : [],
            actionItems: Array.isArray(data.actionItems) ? data.actionItems : [],
            checkQuestions: Array.isArray(data.checkQuestions) ? data.checkQuestions : [],
            rawExcerpt: String(data.rawExcerpt || ''),
            studentNameMentions: Array.isArray(data.studentNameMentions)
              ? data.studentNameMentions
              : [],
            classifiedMoments: Array.isArray(data.classifiedMoments)
              ? data.classifiedMoments
              : [],
            tipsAndWarnings: Array.isArray(data.tipsAndWarnings)
              ? data.tipsAndWarnings.map(String)
              : [],
            fullTranscript: typeof data.fullTranscript === 'string' ? data.fullTranscript : '',
            createdAt: timestampToIso(data.createdAt),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/lectures`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubModules = onSnapshot(
    query(collection(db, 'users', uid, 'modules'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
    (snap) => {
      callbacks.onModules(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            courseCode: String(data.courseCode || ''),
            moduleTopic: String(data.moduleTopic || 'General Module'),
            keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
            title: String(data.title || ''),
            fileName: String(data.fileName || ''),
            overview: String(data.overview || ''),
            learningObjectives: Array.isArray(data.learningObjectives) ? data.learningObjectives : [],
            topicBreakdowns: Array.isArray(data.topicBreakdowns) ? data.topicBreakdowns : [],
            difficultyNote: String(data.difficultyNote || ''),
            extractedTextPreview: String(data.extractedTextPreview || ''),
            createdAt: timestampToIso(data.createdAt),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/modules`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubSprints = onSnapshot(
    query(collection(db, 'users', uid, 'sprints'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
    (snap) => {
      const first = snap.docs[0];
      if (!first) {
        callbacks.onSprint(null);
        return;
      }
      const data = first.data();
      callbacks.onSprint({
        id: first.id,
        generatedAt: timestampToIso(data.createdAt),
        hoursAvailable: Number(data.hoursAvailable || 2),
        focusMessage: String(data.focusMessage || ''),
        steps: Array.isArray(data.steps) ? data.steps : [],
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/sprints`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubProgress = onSnapshot(
    query(collection(db, 'users', uid, 'progressReports'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
    (snap) => {
      const first = snap.docs[0];
      if (!first) {
        callbacks.onProgressReport(null);
        return;
      }
      const data = first.data();
      callbacks.onProgressReport({
        id: first.id,
        createdAt: timestampToIso(data.createdAt),
        overallStatusSummary: String(data.overallStatusSummary || ''),
        analyzedEmailCount: Number(data.analyzedEmailCount || 0),
        courseProgress: Array.isArray(data.courseProgress) ? data.courseProgress : [],
        prioritizedTopics: Array.isArray(data.prioritizedTopics) ? data.prioritizedTopics : [],
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/progressReports`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubTutor = onSnapshot(
    query(collection(db, 'users', uid, 'tutorThreads'), where('ownerId', '==', uid), orderBy('updatedAt', 'desc')),
    (snap) => {
      callbacks.onTutorThreads(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            mode: data.mode === 'socratic' ? 'socratic' : 'qa',
            focusCourse: String(data.focusCourse || 'ALL'),
            masteredConcepts: Array.isArray(data.masteredConcepts)
              ? data.masteredConcepts.map(String)
              : [],
            title: String(data.title || 'Course Study Assistant'),
            messages: Array.isArray(data.messages) ? data.messages : [],
            createdAt: timestampToIso(data.createdAt),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/tutorThreads`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubQuizzes = onSnapshot(
    query(collection(db, 'users', uid, 'quizzes'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
    (snap) => {
      callbacks.onQuizzes(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title || 'Course Practice Quiz'),
            courseCode: String(data.courseCode || 'ALL'),
            topicFocus: String(data.topicFocus || 'Course Review'),
            difficulty:
              data.difficulty === 'Review' || data.difficulty === 'Challenge'
                ? data.difficulty
                : 'Standard',
            questions: Array.isArray(data.questions) ? data.questions : [],
            answers: Array.isArray(data.answers) ? data.answers : [],
            score: Number(data.score || 0),
            totalQuestions: Number(data.totalQuestions || 1),
            completed: Boolean(data.completed),
            createdAt: timestampToIso(data.createdAt),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/quizzes`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  const unsubNotes = onSnapshot(
    query(collection(db, 'users', uid, 'notes'), where('ownerId', '==', uid), orderBy('updatedAt', 'desc')),
    (snap) => {
      callbacks.onNotes(
        snap.docs.map((d) => {
          const data = d.data();
          const rawSettings = (data.codeSettings || {}) as Partial<SmartNoteCodeSettings>;
          return {
            id: d.id,
            courseCode: String(data.courseCode || 'AIL1001'),
            title: String(data.title || 'Untitled Note'),
            cardType:
              data.cardType === 'code' ||
              data.cardType === 'checklist' ||
              data.cardType === 'flashcard' ||
              data.cardType === 'template'
                ? data.cardType
                : 'note',
            colorTag:
              data.colorTag === 'blue' ||
              data.colorTag === 'amber' ||
              data.colorTag === 'emerald' ||
              data.colorTag === 'rose'
                ? data.colorTag
                : 'slate',
            pinned: Boolean(data.pinned),
            content: String(data.content || ''),
            codeLanguage: String(data.codeLanguage || 'python'),
            codeSettings: {
              theme: rawSettings.theme === 'light' ? 'light' : 'dark',
              showLineNumbers: rawSettings.showLineNumbers !== false,
              wordWrap: Boolean(rawSettings.wordWrap),
              fontSize:
                rawSettings.fontSize === 'sm' || rawSettings.fontSize === 'lg'
                  ? rawSettings.fontSize
                  : 'md',
            },
            checklistItems: Array.isArray(data.checklistItems)
              ? data.checklistItems.map((item: { text?: unknown; done?: unknown }) => ({
                  text: String(item.text || ''),
                  done: Boolean(item.done),
                }))
              : [],
            keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
            reminderAt: String(data.reminderAt || ''),
            sourceLabel: String(data.sourceLabel || 'Smart Notebook'),
            emailSubject: typeof data.emailSubject === 'string' ? data.emailSubject : '',
            flashcardHint: typeof data.flashcardHint === 'string' ? data.flashcardHint : '',
            createdAt: timestampToIso(data.createdAt),
          };
        }),
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/notes`);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    },
  );

  return () => {
    unsubCourses();
    unsubTasks();
    unsubLectures();
    unsubModules();
    unsubSprints();
    unsubProgress();
    unsubTutor();
    unsubQuizzes();
    unsubNotes();
  };
}

export async function createCourseDoc(uid: string, course: Omit<Course, 'id'>): Promise<void> {
  const id = makeDocId('course');
  const path = `users/${uid}/courses/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'courses', id), {
      ownerId: uid,
      code: clampStr(course.code, 24, 'COURSE'),
      title: clampStr(course.title, 160, 'Untitled Course'),
      lecturer: clampStr(course.lecturer, 120, 'TBA'),
      semester: clampStr(course.semester, 120, 'Semester 1'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCourseDoc(uid: string, courseId: string): Promise<void> {
  const path = `users/${uid}/courses/${courseId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'courses', courseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createTaskDoc(
  uid: string,
  task: Omit<ClassworkItem, 'id' | 'createdAt'>,
): Promise<void> {
  const id = makeDocId('task');
  const path = `users/${uid}/tasks/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'tasks', id), {
      ownerId: uid,
      courseCode: clampStr(task.courseCode, 24, 'AI-101'),
      courseTitle: clampStr(task.courseTitle, 160, 'AI Associate Degree'),
      title: clampStr(task.title, 240, 'Classwork Task'),
      type: task.type,
      status: task.status,
      dueDate: clampStr(task.dueDate, 32, 'TBD'),
      estimatedMinutes: Math.max(1, Math.min(600, Math.round(Number(task.estimatedMinutes) || 30))),
      source: task.source,
      notes: clampStr(task.notes, 2000, ''),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTaskStatusDoc(
  uid: string,
  taskId: string,
  status: ClassworkStatus,
): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTaskDoc(uid: string, taskId: string): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createLectureDoc(
  uid: string,
  lecture: Omit<LectureAnalysis, 'id' | 'createdAt'>,
): Promise<string> {
  const id = makeDocId('lec');
  const path = `users/${uid}/lectures/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'lectures', id), {
      ownerId: uid,
      courseCode: clampStr(lecture.courseCode, 24, 'AI-101'),
      moduleTopic: clampStr(lecture.moduleTopic, 160, 'General Lecture'),
      keywords: clampKeywords(lecture.keywords),
      title: clampStr(lecture.title, 240, 'Zoom Class'),
      lectureDate: clampStr(lecture.lectureDate, 32, new Date().toISOString().slice(0, 10)),
      sourceType: lecture.sourceType,
      fileName: clampStr(lecture.fileName, 240, 'Transcript'),
      durationOrLines: clampStr(lecture.durationOrLines, 80, 'Analyzed'),
      plainEnglishSummary: clampStr(lecture.plainEnglishSummary, 4000, 'Summary generated.'),
      keyConcepts: (lecture.keyConcepts || []).slice(0, 25),
      actionItems: (lecture.actionItems || []).slice(0, 25),
      checkQuestions: (lecture.checkQuestions || []).slice(0, 15),
      rawExcerpt: clampStr(lecture.rawExcerpt, 8000, ''),
      ...(Array.isArray(lecture.studentNameMentions)
        ? {
            studentNameMentions: lecture.studentNameMentions.slice(0, 25).map((m) => ({
              timestamp: clampStr(m.timestamp, 24, '00:00'),
              startSeconds: Math.max(0, Math.round(Number(m.startSeconds) || 0)),
              context: clampStr(m.context, 800, ''),
              reason: clampStr(m.reason, 400, ''),
            })),
          }
        : {}),
      ...(Array.isArray(lecture.classifiedMoments)
        ? {
            classifiedMoments: lecture.classifiedMoments.slice(0, 50).map((m) => ({
              timestamp: clampStr(m.timestamp, 24, '00:00'),
              startSeconds: Math.max(0, Math.round(Number(m.startSeconds) || 0)),
              endSeconds: Math.max(0, Math.round(Number(m.endSeconds) || 0)),
              category: m.category || 'Key Point',
              title: clampStr(m.title, 200, 'Key Moment'),
              summary: clampStr(m.summary, 1000, ''),
              codeSnippet: clampStr(m.codeSnippet, 3000, ''),
              codeLanguage: clampStr(m.codeLanguage, 32, ''),
              screenshotNeeded: Boolean(m.screenshotNeeded),
            })),
          }
        : {}),
      ...(Array.isArray(lecture.tipsAndWarnings)
        ? {
            tipsAndWarnings: lecture.tipsAndWarnings
              .slice(0, 25)
              .map((t) => clampStr(t, 480, ''))
              .filter(Boolean),
          }
        : {}),
      ...(typeof lecture.fullTranscript === 'string' && lecture.fullTranscript.trim()
        ? { fullTranscript: clampStr(lecture.fullTranscript, 24900, '') }
        : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateLectureActionsDoc(
  uid: string,
  lectureId: string,
  actionItems: LectureAnalysis['actionItems'],
): Promise<void> {
  const path = `users/${uid}/lectures/${lectureId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'lectures', lectureId), {
      actionItems: actionItems.slice(0, 25),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateLectureOrganizationDoc(
  uid: string,
  lectureId: string,
  updates: { courseCode: string; moduleTopic: string; keywords: string[]; title: string },
): Promise<void> {
  const path = `users/${uid}/lectures/${lectureId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'lectures', lectureId), {
      courseCode: clampStr(updates.courseCode, 24, 'AI-101'),
      moduleTopic: clampStr(updates.moduleTopic, 160, 'General Lecture'),
      keywords: clampKeywords(updates.keywords),
      title: clampStr(updates.title, 240, 'Zoom Class'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLectureDoc(uid: string, lectureId: string): Promise<void> {
  const path = `users/${uid}/lectures/${lectureId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'lectures', lectureId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createModuleDoc(
  uid: string,
  mod: Omit<ModuleGuide, 'id' | 'createdAt'>,
): Promise<string> {
  const id = makeDocId('mod');
  const path = `users/${uid}/modules/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'modules', id), {
      ownerId: uid,
      courseCode: clampStr(mod.courseCode, 24, 'AI-101'),
      moduleTopic: clampStr(mod.moduleTopic, 160, 'General Module'),
      keywords: clampKeywords(mod.keywords),
      title: clampStr(mod.title, 240, 'Course Module'),
      fileName: clampStr(mod.fileName, 240, 'Module File'),
      overview: clampStr(mod.overview, 4000, 'Overview generated.'),
      learningObjectives: (mod.learningObjectives || [])
        .slice(0, 20)
        .map((s) => clampStr(s, 500, 'Objective')),
      topicBreakdowns: (mod.topicBreakdowns || []).slice(0, 30),
      difficultyNote: clampStr(mod.difficultyNote, 2000, ''),
      extractedTextPreview: clampStr(mod.extractedTextPreview, 8000, ''),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateModuleOrganizationDoc(
  uid: string,
  moduleId: string,
  updates: { courseCode: string; moduleTopic: string; keywords: string[]; title: string },
): Promise<void> {
  const path = `users/${uid}/modules/${moduleId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'modules', moduleId), {
      courseCode: clampStr(updates.courseCode, 24, 'AI-101'),
      moduleTopic: clampStr(updates.moduleTopic, 160, 'General Module'),
      keywords: clampKeywords(updates.keywords),
      title: clampStr(updates.title, 240, 'Course Module'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteModuleDoc(uid: string, moduleId: string): Promise<void> {
  const path = `users/${uid}/modules/${moduleId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'modules', moduleId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createSprintDoc(
  uid: string,
  sprint: Omit<CatchUpSprint, 'id' | 'generatedAt'>,
): Promise<void> {
  const id = makeDocId('sprint');
  const path = `users/${uid}/sprints/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'sprints', id), {
      ownerId: uid,
      hoursAvailable: Math.max(0.5, Math.min(24, Number(sprint.hoursAvailable) || 2)),
      focusMessage: clampStr(sprint.focusMessage, 1000, 'Focus on one step at a time.'),
      steps: (sprint.steps || []).slice(0, 20),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSprintStepsDoc(
  uid: string,
  sprintId: string,
  steps: CatchUpSprint['steps'],
): Promise<void> {
  const path = `users/${uid}/sprints/${sprintId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'sprints', sprintId), {
      steps: steps.slice(0, 20),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createProgressReportDoc(
  uid: string,
  report: Omit<ProgressReport, 'id' | 'createdAt'>,
): Promise<void> {
  const id = makeDocId('report');
  const path = `users/${uid}/progressReports/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'progressReports', id), {
      ownerId: uid,
      overallStatusSummary: clampStr(
        report.overallStatusSummary,
        2000,
        'Progress report generated.',
      ),
      analyzedEmailCount: Math.max(0, Math.min(100, Math.round(Number(report.analyzedEmailCount) || 0))),
      courseProgress: (report.courseProgress || []).slice(0, 20),
      prioritizedTopics: (report.prioritizedTopics || []).slice(0, 25),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveTutorThreadMessagesDoc(
  uid: string,
  existingThreadId: string | null,
  payload: {
    mode: TutorMode;
    focusCourse: string;
    masteredConcepts: string[];
    messages: TutorMessage[];
    title?: string;
  },
): Promise<string> {
  const sanitized = payload.messages.slice(-40).map((m) => ({
    role: m.role,
    text: clampStr(m.text, 6000, ''),
    citations: Array.isArray(m.citations) ? m.citations.slice(0, 8) : [],
    ...(m.evaluationStatus ? { evaluationStatus: m.evaluationStatus } : {}),
    ...(m.conceptFocus ? { conceptFocus: clampStr(m.conceptFocus, 160, '') } : {}),
    ...(m.hintText ? { hintText: clampStr(m.hintText, 1200, '') } : {}),
  }));

  const safeMastered = Array.from(
    new Set(
      (payload.masteredConcepts || [])
        .map((c) => clampStr(c, 120, ''))
        .filter(Boolean),
    ),
  ).slice(0, 30);

  const threadTitle = clampStr(
    payload.title ||
      sanitized.find((m) => m.role === 'user')?.text ||
      (payload.mode === 'socratic' ? 'Mastery Coach Session' : 'Course Study Assistant'),
    160,
    'Course Study Assistant',
  );

  const safeCourse = clampStr(payload.focusCourse, 24, 'ALL');

  if (existingThreadId) {
    const path = `users/${uid}/tutorThreads/${existingThreadId}`;
    try {
      await updateDoc(doc(db, 'users', uid, 'tutorThreads', existingThreadId), {
        mode: payload.mode,
        focusCourse: safeCourse,
        masteredConcepts: safeMastered,
        messages: sanitized,
        title: threadTitle,
        updatedAt: serverTimestamp(),
      });
      return existingThreadId;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    const id = makeDocId('thread');
    const path = `users/${uid}/tutorThreads/${id}`;
    try {
      await setDoc(doc(db, 'users', uid, 'tutorThreads', id), {
        ownerId: uid,
        mode: payload.mode,
        focusCourse: safeCourse,
        masteredConcepts: safeMastered,
        title: threadTitle,
        messages: sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

export async function clearTutorThreadDoc(uid: string, threadId: string): Promise<void> {
  const path = `users/${uid}/tutorThreads/${threadId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tutorThreads', threadId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createQuizDoc(
  uid: string,
  quiz: Omit<InteractiveQuiz, 'id' | 'createdAt'>,
): Promise<string> {
  const id = makeDocId('quiz');
  const path = `users/${uid}/quizzes/${id}`;
  const safeQuestions = (quiz.questions || []).slice(0, 15);
  const safeTotal = Math.max(1, Math.min(15, safeQuestions.length || quiz.totalQuestions || 1));
  try {
    await setDoc(doc(db, 'users', uid, 'quizzes', id), {
      ownerId: uid,
      title: clampStr(quiz.title, 200, 'Course Practice Quiz'),
      courseCode: clampStr(quiz.courseCode, 24, 'ALL'),
      topicFocus: clampStr(quiz.topicFocus, 200, 'Course Review'),
      difficulty: quiz.difficulty,
      questions: safeQuestions,
      answers: (quiz.answers || []).slice(0, 15),
      score: Math.max(0, Math.min(15, Math.round(Number(quiz.score) || 0))),
      totalQuestions: safeTotal,
      completed: Boolean(quiz.completed),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateQuizProgressDoc(
  uid: string,
  quizId: string,
  updates: {
    answers: QuizAnswerRecord[];
    score: number;
    completed: boolean;
  },
): Promise<void> {
  const path = `users/${uid}/quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'quizzes', quizId), {
      answers: (updates.answers || []).slice(0, 15),
      score: Math.max(0, Math.min(15, Math.round(Number(updates.score) || 0))),
      completed: Boolean(updates.completed),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteQuizDoc(uid: string, quizId: string): Promise<void> {
  const path = `users/${uid}/quizzes/${quizId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'quizzes', quizId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function sanitizeNotePayload(
  note: Omit<SmartNoteCard, 'id' | 'createdAt'>,
): Record<string, unknown> {
  const cardType =
    note.cardType === 'code' ||
    note.cardType === 'checklist' ||
    note.cardType === 'flashcard' ||
    note.cardType === 'template'
      ? note.cardType
      : 'note';
  const colorTag =
    note.colorTag === 'blue' ||
    note.colorTag === 'amber' ||
    note.colorTag === 'emerald' ||
    note.colorTag === 'rose'
      ? note.colorTag
      : 'slate';
  const settings = note.codeSettings || {
    theme: 'dark',
    showLineNumbers: true,
    wordWrap: false,
    fontSize: 'md',
  };
  return {
    courseCode: clampStr(note.courseCode, 24, 'AIL1001'),
    title: clampStr(note.title, 200, 'Untitled Note'),
    cardType,
    colorTag,
    pinned: Boolean(note.pinned),
    content: String(note.content ?? '').slice(0, 12000),
    codeLanguage: clampStr(note.codeLanguage, 32, 'python'),
    codeSettings: {
      theme: settings.theme === 'light' ? 'light' : 'dark',
      showLineNumbers: Boolean(settings.showLineNumbers),
      wordWrap: Boolean(settings.wordWrap),
      fontSize:
        settings.fontSize === 'sm' || settings.fontSize === 'lg' ? settings.fontSize : 'md',
    },
    checklistItems: (note.checklistItems || []).slice(0, 40).map((item) => ({
      text: clampStr(item.text, 300, 'Item'),
      done: Boolean(item.done),
    })),
    keywords: clampKeywords(note.keywords),
    reminderAt: clampStr(note.reminderAt, 40, ''),
    sourceLabel: clampStr(note.sourceLabel, 160, 'Smart Notebook'),
    emailSubject: String(note.emailSubject ?? '').trim().slice(0, 240),
    flashcardHint: String(note.flashcardHint ?? '').trim().slice(0, 400),
  };
}

export async function createSmartNoteDoc(
  uid: string,
  note: Omit<SmartNoteCard, 'id' | 'createdAt'>,
): Promise<string> {
  const id = makeDocId('note');
  const path = `users/${uid}/notes/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'notes', id), {
      ownerId: uid,
      ...sanitizeNotePayload(note),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSmartNoteDoc(
  uid: string,
  noteId: string,
  note: Omit<SmartNoteCard, 'id' | 'createdAt'>,
): Promise<void> {
  const path = `users/${uid}/notes/${noteId}`;
  try {
    const clean = sanitizeNotePayload(note);
    delete clean.sourceLabel;
    await updateDoc(doc(db, 'users', uid, 'notes', noteId), {
      ...clean,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSmartNoteDoc(uid: string, noteId: string): Promise<void> {
  const path = `users/${uid}/notes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'notes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearAllUserData(uid: string): Promise<void> {
  const subcollections = [
    'courses',
    'tasks',
    'lectures',
    'modules',
    'sprints',
    'progressReports',
    'tutorThreads',
    'quizzes',
    'notes',
  ] as const;
  try {
    const batch = writeBatch(db);
    for (const sub of subcollections) {
      const snap = await getDocs(
        query(collection(db, 'users', uid, sub), where('ownerId', '==', uid)),
      );
      for (const d of snap.docs) {
        batch.delete(d.ref);
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
  }
}
