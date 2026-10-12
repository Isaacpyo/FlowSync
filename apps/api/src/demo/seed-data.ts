import type { Priority } from '@flowsync/shared';

export interface SeedTeammate {
  key: string;
  name: string;
  email: string;
  avatarColor: string;
  role: 'OWNER' | 'MEMBER';
}

export interface SeedTask {
  title: string;
  priority: Priority;
  assignee?: string;
  dueInDays?: number;
  description?: string;
}

export interface SeedBoard {
  name: string;
  description: string;
  columns: { name: string; tasks: SeedTask[] }[];
  messages: { author: string; body: string; minutesAgo: number }[];
}

export const DEMO_WORKSPACE_NAME = 'Acme Studio (demo)';

export const TEAMMATES: SeedTeammate[] = [
  { key: 'ava', name: 'Ava Chen', email: 'ava@example.com', avatarColor: '#6366f1', role: 'OWNER' },
  {
    key: 'ben',
    name: 'Ben Okafor',
    email: 'ben@example.com',
    avatarColor: '#10b981',
    role: 'MEMBER',
  },
  {
    key: 'chloe',
    name: 'Chloe Martin',
    email: 'chloe@example.com',
    avatarColor: '#ec4899',
    role: 'MEMBER',
  },
  {
    key: 'diego',
    name: 'Diego Ruiz',
    email: 'diego@example.com',
    avatarColor: '#f59e0b',
    role: 'MEMBER',
  },
];

export const BOARDS: SeedBoard[] = [
  {
    name: 'Website relaunch',
    description: 'Q4 marketing site rebuild: design, copy and launch.',
    columns: [
      {
        name: 'Backlog',
        tasks: [
          { title: 'Localise pricing page (FR, DE)', priority: 'LOW', assignee: 'diego' },
          { title: 'A/B test hero headline variants', priority: 'MEDIUM' },
          { title: 'Add customer logo wall', priority: 'LOW', assignee: 'chloe' },
        ],
      },
      {
        name: 'To do',
        tasks: [
          {
            title: 'Write launch announcement blog post',
            priority: 'HIGH',
            assignee: 'chloe',
            dueInDays: 5,
            description: 'Angle: "built with our customers". Include 2 quotes and the new pricing.',
          },
          { title: 'Set up redirects from legacy URLs', priority: 'MEDIUM', assignee: 'diego' },
          {
            title: 'Accessibility audit (WCAG 2.2 AA)',
            priority: 'HIGH',
            assignee: 'ben',
            dueInDays: 7,
          },
        ],
      },
      {
        name: 'In progress',
        tasks: [
          {
            title: 'Design new pricing page',
            priority: 'URGENT',
            assignee: 'ava',
            dueInDays: 2,
            description:
              'Three tiers, annual/monthly toggle, comparison table. Mobile first; the table collapses into accordions under 640px.',
          },
          { title: 'Migrate blog to MDX', priority: 'MEDIUM', assignee: 'ben' },
        ],
      },
      {
        name: 'Review',
        tasks: [
          {
            title: 'Hero illustration: final pass',
            priority: 'HIGH',
            assignee: 'chloe',
            dueInDays: 1,
          },
          { title: 'Core Web Vitals budget in CI', priority: 'MEDIUM', assignee: 'ben' },
        ],
      },
      {
        name: 'Done',
        tasks: [
          { title: 'Kick-off workshop', priority: 'LOW', assignee: 'ava' },
          { title: 'Competitor teardown', priority: 'MEDIUM', assignee: 'diego' },
          { title: 'Sitemap & information architecture', priority: 'HIGH', assignee: 'ava' },
        ],
      },
    ],
    messages: [
      {
        author: 'ava',
        minutesAgo: 190,
        body: 'Morning! Pricing page mocks are up, feedback welcome before noon 🙏',
      },
      {
        author: 'chloe',
        minutesAgo: 175,
        body: "Looks great. I'd move the annual toggle above the fold.",
      },
      {
        author: 'ben',
        minutesAgo: 160,
        body: 'Lighthouse is at 94 on the new hero; the illustration is the heaviest asset.',
      },
      {
        author: 'diego',
        minutesAgo: 95,
        body: 'Redirect map is drafted, picking it up after lunch.',
      },
      {
        author: 'ava',
        minutesAgo: 30,
        body: 'New here? Drag a card, or open this board in a second browser: you will see each other’s cursors, presence and edits live.',
      },
    ],
  },
  {
    name: 'Mobile app: Sprint 14',
    description: 'Two-week sprint for the iOS and Android apps.',
    columns: [
      {
        name: 'To do',
        tasks: [
          {
            title: 'Crash on Android 12 when rotating',
            priority: 'URGENT',
            assignee: 'ben',
            dueInDays: 1,
            description: 'Repro: open a task, rotate twice. Stack trace points at the date picker.',
          },
          { title: 'Offline mode for task list', priority: 'HIGH', assignee: 'ben' },
          { title: 'Push notification preferences', priority: 'MEDIUM', assignee: 'diego' },
        ],
      },
      {
        name: 'In progress',
        tasks: [
          { title: 'Biometric login', priority: 'HIGH', assignee: 'ava', dueInDays: 4 },
          { title: 'Dark mode polish', priority: 'LOW', assignee: 'chloe' },
        ],
      },
      {
        name: 'Done',
        tasks: [
          { title: 'Upgrade React Native', priority: 'MEDIUM', assignee: 'ben' },
          { title: 'Onboarding carousel', priority: 'MEDIUM', assignee: 'chloe' },
        ],
      },
    ],
    messages: [
      { author: 'ben', minutesAgo: 240, body: 'Rotation crash is reproducible, on it today.' },
      { author: 'ava', minutesAgo: 200, body: 'Thanks! Biometric login PR should be up tomorrow.' },
    ],
  },
];
