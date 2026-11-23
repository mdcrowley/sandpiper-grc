// Training and exercises: courses, assignment rules, completion records and their import;
// tabletop exercises, restore tests and continuity tests with findings and follow-up actions.
import type { ModuleDef } from '../../core';
import { CourseDetail, CourseList } from './CoursePages';
import { ExerciseCalendar } from './ExerciseCalendar';
import { ExerciseDetail, ExerciseList } from './ExercisePages';
import { TrainingImport } from './Import';
import { MyTraining } from './MyTraining';
import { TrainingOverview } from './Overview';
import { CertificationDetail, CertificationList, QualificationMatrix } from './Qualifications';
import { TrainingRecords } from './Records';
import './training.css';

const mod: ModuleDef = {
  key: 'training',
  nav: [
    { group: 'Cybersecurity', label: 'Training overview', path: '/training', icon: 'graduation', permission: 'training.view', order: 85 },
    { group: 'Cybersecurity', label: 'Courses', path: '/training/courses', icon: 'book', permission: 'training.view', order: 86 },
    { group: 'Cybersecurity', label: 'My training', path: '/training/mine', icon: 'user', order: 87 },
    // Qualifications of the roster (E29) are about people: the matrix needs people.view as well as training.view.
    { group: 'People', label: 'Qualifications', path: '/training/qualifications', icon: 'check-square', permission: 'training.view', permissions: ['people.view'], order: 30 },
    { group: 'People', label: 'Certifications', path: '/training/certifications', icon: 'star', permission: 'training.view', order: 40 },
    { group: 'Cybersecurity', label: 'Exercises', path: '/exercises', icon: 'clipboard', permission: 'exercises.view', order: 88 },
    { group: 'Cybersecurity', label: 'Exercise calendar', path: '/exercises/calendar', icon: 'calendar', permission: 'exercises.view', order: 89 },
  ],
  routes: [
    { path: '/training', element: <TrainingOverview />, permission: 'training.view' },
    { path: '/training/courses', element: <CourseList />, permission: 'training.view' },
    { path: '/training/courses/:id', element: <CourseDetail />, permission: 'training.view' },
    { path: '/training/records', element: <TrainingRecords />, permission: 'training.view' },
    { path: '/training/import', element: <TrainingImport />, permission: 'training.create' },
    { path: '/training/mine', element: <MyTraining /> },
    { path: '/training/qualifications', element: <QualificationMatrix />, permission: 'training.view' },
    { path: '/training/certifications', element: <CertificationList />, permission: 'training.view' },
    { path: '/training/certifications/:id', element: <CertificationDetail />, permission: 'training.view' },
    { path: '/exercises', element: <ExerciseList />, permission: 'exercises.view' },
    { path: '/exercises/calendar', element: <ExerciseCalendar />, permission: 'exercises.view' },
    { path: '/exercises/:id', element: <ExerciseDetail />, permission: 'exercises.view' },
  ],
  create: [
    { label: 'Course', path: '/training/courses?new=1', permission: 'training.create', icon: 'graduation' },
    { label: 'Certification', path: '/training/certifications?new=1', permission: 'training.create', icon: 'star' },
    { label: 'Exercise', path: '/exercises?new=1', permission: 'exercises.create', icon: 'clipboard' },
  ],
};

export default mod;
