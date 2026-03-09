import { PlannerForm } from './types';

export const samplePlan: PlannerForm = {
  planName: 'Quarterly workspace',
  income: {
    payFrequency: 'biweekly',
    firstPaycheckAmount: 0,
    secondPaycheckAmount: 0,
    extraIncome: 0,
    windowCutoffDay: 15,
  },
  spending: {
    firstWindowPersonalSpend: 0,
    secondWindowPersonalSpend: 0,
  },
  splitBills: [],
  panels: {
    overview: {
      collapsed: false,
      layout: {
        x: 72,
        y: 84,
        width: 420,
        height: 220,
        zIndex: 1,
      },
    },
    summary: {
      collapsed: false,
      layout: {
        x: 520,
        y: 84,
        width: 420,
        height: 220,
        zIndex: 2,
      },
    },
    controls: {
      collapsed: false,
      layout: {
        x: 968,
        y: 84,
        width: 300,
        height: 220,
        zIndex: 3,
      },
    },
    signals: {
      collapsed: false,
      layout: {
        x: 1296,
        y: 84,
        width: 300,
        height: 220,
        zIndex: 4,
      },
    },
    splitLedger: {
      collapsed: false,
      layout: {
        x: 1180,
        y: 340,
        width: 560,
        height: 360,
        zIndex: 5,
      },
    },
    firstWindow: {
      collapsed: false,
      layout: {
        x: 1180,
        y: 728,
        width: 360,
        height: 300,
        zIndex: 6,
      },
    },
    secondWindow: {
      collapsed: false,
      layout: {
        x: 1568,
        y: 728,
        width: 360,
        height: 300,
        zIndex: 7,
      },
    },
  },
  debts: [],
};
