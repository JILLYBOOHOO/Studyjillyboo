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
        program: 'Associate Degree in Artificial Intelligence · Jamaica',
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

export async function seedStarterWorkspace(uid: string): Promise<void> {
  const batch = writeBatch(db);

  const starterCourses = [
    {
      id: 'course_ai101',
      code: 'AI-101',
      title: 'Foundations of Artificial Intelligence',
      lecturer: 'Mr. Campbell',
      semester: 'Semester 1 · Associate Degree in AI',
    },
    {
      id: 'course_py102',
      code: 'PY-102',
      title: 'Python Programming for Data Science',
      lecturer: 'Ms. Brown',
      semester: 'Semester 1 · Associate Degree in AI',
    },
    {
      id: 'course_mth104',
      code: 'MTH-104',
      title: 'Linear Algebra & Calculus for AI',
      lecturer: 'Dr. Gordon',
      semester: 'Semester 1 · Associate Degree in AI',
    },
    {
      id: 'course_db105',
      code: 'DB-105',
      title: 'Database Systems & SQL',
      lecturer: 'Mr. Clarke',
      semester: 'Semester 1 · Associate Degree in AI',
    },
  ];

  for (const c of starterCourses) {
    batch.set(doc(db, 'users', uid, 'courses', c.id), {
      ownerId: uid,
      code: c.code,
      title: c.title,
      lecturer: c.lecturer,
      semester: c.semester,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const starterTasks = [
    {
      id: 'task_starter_1',
      courseCode: 'AI-101',
      courseTitle: 'Foundations of Artificial Intelligence',
      title: 'Catch up on Week 4 Zoom lecture: Search Algorithms (BFS vs A*)',
      type: 'Lecture Catch-Up',
      status: 'Urgent Catch-Up',
      dueDate: '2026-11-19',
      estimatedMinutes: 45,
      source: 'Manual',
      notes: 'Download Zoom recording & transcript from portal and review heuristic examples.',
    },
    {
      id: 'task_starter_2',
      courseCode: 'PY-102',
      courseTitle: 'Python Programming for Data Science',
      title: 'Lab 3: NumPy Array Slicing & Vectorized Operations',
      type: 'Lab',
      status: 'Urgent Catch-Up',
      dueDate: '2026-11-20',
      estimatedMinutes: 60,
      source: 'Manual',
      notes: 'Focus on broadcasting shapes and avoiding nested loops.',
    },
    {
      id: 'task_starter_3',
      courseCode: 'MTH-104',
      courseTitle: 'Linear Algebra & Calculus for AI',
      title: 'Module 3 Workbook: Matrix Multiplication & Dot Products',
      type: 'Module Reading',
      status: 'In Progress',
      dueDate: '2026-11-22',
      estimatedMinutes: 50,
      source: 'Module File',
      notes: 'Review step-by-step worked examples before attempting practice set.',
    },
    {
      id: 'task_starter_4',
      courseCode: 'DB-105',
      courseTitle: 'Database Systems & SQL',
      title: 'Assignment 2: Normalization (1NF to 3NF) & JOIN Queries',
      type: 'Assignment',
      status: 'Upcoming',
      dueDate: '2026-11-25',
      estimatedMinutes: 75,
      source: 'Manual',
      notes: 'Check email for schema starter file.',
    },
  ];

  for (const t of starterTasks) {
    batch.set(doc(db, 'users', uid, 'tasks', t.id), {
      ownerId: uid,
      ...t,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'users', uid, 'lectures', 'lec_starter_1'), {
    ownerId: uid,
    courseCode: 'AI-101',
    moduleTopic: 'Module 3: Supervised Learning',
    keywords: ['supervised learning', 'linear regression', 'features', 'MSE loss', 'train-test split'],
    title: 'Week 3: Supervised Learning & Linear Regression Intuition',
    lectureDate: '2026-11-12',
    sourceType: 'Transcript',
    fileName: 'AI101_Week3_Zoom.vtt',
    durationOrLines: 'Sample starter note',
    plainEnglishSummary:
      'This class introduced how supervised machine learning learns patterns from labeled examples. Instead of writing rigid if/else rules by hand, the model draws a best-fit line through past data points to predict future numbers.',
    keyConcepts: [
      {
        term: 'Features (X) vs. Target (y)',
        simpleExplanation:
          'Features are the input clues you give the model; the target is the answer you want it to predict.',
        analogyOrExample:
          'When predicting exam grades, study hours and attendance are Features (X), and the final grade is the Target (y).',
      },
      {
        term: 'Loss Function (Mean Squared Error)',
        simpleExplanation:
          'A scorecard that measures how far off the model predictions are from the real answers.',
        analogyOrExample:
          'Like checking how many points you missed on a practice paper—smaller loss means better predictions.',
      },
    ],
    actionItems: [
      {
        title: 'Complete Week 3 Regression Practice Worksheet',
        type: 'Assignment',
        dueHint: 'Before next Tuesday class',
        estimatedMinutes: 40,
        addedToTracker: false,
      },
    ],
    checkQuestions: [
      {
        question: 'In supervised learning, why do we split data into training and test sets?',
        answer:
          'So we can check if the model actually learned general patterns instead of memorizing the training answers.',
      },
    ],
    rawExcerpt:
      'Sample lecture note included so you can preview how uploaded Zoom transcripts and recordings are broken down.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'users', uid, 'modules', 'mod_starter_1'), {
    ownerId: uid,
    courseCode: 'PY-102',
    moduleTopic: 'Module 2: Python Data Structures & NumPy',
    keywords: ['NumPy', 'dictionaries', 'vectorization', 'array shape', 'Python'],
    title: 'Module 2: Python Lists, Dictionaries & NumPy Basics',
    fileName: 'PY102_Module2_Guide.pdf',
    overview:
      'Covers how Python stores collections of data and why NumPy arrays are used in AI instead of plain Python lists when working with large datasets.',
    learningObjectives: [
      'Choose between a Python list and a dictionary for structured data.',
      'Create 1D and 2D NumPy arrays and check their .shape.',
      'Perform fast vectorized math on whole arrays without writing for-loops.',
    ],
    topicBreakdowns: [
      {
        topic: 'Python Dictionaries (Key-Value Pairs)',
        plainEnglish:
          'A dictionary stores labeled data so you look up values by name instead of guessing an index number.',
        keyTakeaway: 'Use curly braces {} with key: value pairs when data has named fields.',
        exampleOrCode:
          "student = {'program': 'AI Associate', 'module': 2}\nprint(student['program'])",
      },
      {
        topic: 'Why NumPy Arrays Beat Lists in AI',
        plainEnglish:
          'NumPy packs numbers tightly in memory so you can multiply thousands of numbers at once in one line of code.',
        keyTakeaway: 'Always inspect array.shape first—most beginner AI errors come from mismatched shapes.',
        exampleOrCode:
          'import numpy as np\nscores = np.array([72, 85, 90])\ncurved = scores + 5',
      },
    ],
    difficultyNote:
      'Students often get stuck on 2D array indexing (rows first, columns second: arr[row, col]). Practice with a 2x3 grid on paper first.',
    extractedTextPreview:
      'Sample module breakdown. Upload your own downloaded PDF, TXT, MD, PY, or IPYNB module file above to generate a custom guide.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
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

  return () => {
    unsubCourses();
    unsubTasks();
    unsubLectures();
    unsubModules();
    unsubSprints();
    unsubProgress();
    unsubTutor();
    unsubQuizzes();
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
