// My work (/my-work, E44-02): everything waiting for the signed-in person, gathered from the areas
// that give people work. Its tabs are the full lists, each on its own page in its own module (My
// actions, Approvals, My training, My acknowledgments, My access reviews, Delivered to me): those
// pages' menu entries name '/my-work' as their parent, so the shell draws the strip on all of them.
import type { ModuleDef } from '../../core';
import { MyWorkPage } from './MyWorkPage';

const mod: ModuleDef = {
  key: 'mywork',
  nav: [
    { group: 'Home', label: 'My work', path: '/my-work', icon: 'check-circle', order: 10, tabs: 'Summary' },
  ],
  routes: [{ path: '/my-work', element: <MyWorkPage /> }],
};
export default mod;
