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
import { TrainingSettings } from './Settings';
import './training.css';

const mod: ModuleDef = {
  key: 'training',
  nav: [
    { group: 'Home', label: 'My training', path: '/training/mine', icon: 'user', order: 33, menu: false, parent: '/my-work', tab: 'Training' },
    { group: 'People and training', label: 'Training overview', path: '/training', icon: 'graduation', permission: 'training.view', order: 20, tabs: 'Overview' },
    { group: 'People and training', label: 'Courses', path: '/training/courses', icon: 'book', permission: 'training.view', order: 21, menu: false, parent: '/training', tab: 'Courses' },
    // E44-10: the reminder interval has an address of its own: the last tab of Training and an Administration card.
    { group: 'People and training', label: 'Training settings', path: '/training/settings', icon: 'settings', permission: 'training.administer', order: 22, menu: false, parent: '/training', tab: 'Settings', hub: 'Area settings', hint: 'When people are reminded of training past its due date.' },
    // Qualifications of the roster (E29) are about people: the matrix needs people.view as well as training.view.
    { group: 'People and training', label: 'Qualifications', path: '/training/qualifications', icon: 'check-square', permission: 'training.view', permissions: ['people.view'], order: 30, tabs: 'Qualifications' },
    { group: 'People and training', label: 'Certifications', path: '/training/certifications', icon: 'star', permission: 'training.view', order: 31, menu: false, parent: '/training/qualifications', tab: 'Certifications' },
    { group: 'Safety and emergency management', label: 'Exercises', path: '/exercises', icon: 'clipboard', permission: 'exercises.view', order: 60, tabs: 'Exercises' },
    { group: 'Safety and emergency management', label: 'Exercise calendar', path: '/exercises/calendar', icon: 'calendar', permission: 'exercises.view', order: 61, menu: false, parent: '/exercises', tab: 'Calendar' },
  ],
  routes: [
    { path: '/training', element: <TrainingOverview />, permission: 'training.view' },
    { path: '/training/courses', element: <CourseList />, permission: 'training.view' },
    { path: '/training/settings', element: <TrainingSettings />, permission: 'training.administer' },
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
