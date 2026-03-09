import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { QuarterlyWordmark } from './components/QuarterlyWordmark';
import { samplePlan } from './samplePlan';
import { loadWorkspaceFromCloud, saveWorkspaceToCloud } from './lib/cloudWorkspace';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import type {
  CanvasPanelId,
  CanvasPanelState,
  Debt,
  DebtKind,
  DebtRollup,
  PayFrequency,
  PayWindow,
  PlannerForm,
  SplitBill,
  SplitBillKind,
  WindowAllocation,
} from './types';

const storageKey = 'quarterly-plan';
const legacyStorageKey = 'finance-app-desktop-plan';
const themeKey = 'quarterly-theme';
const legacyThemeKey = 'finance-app-desktop-theme';
const authEmailKey = 'quarterly-last-email';
const legacyAuthEmailKey = 'finance-app-desktop-last-email';
const gridSize = 24;
const collapsedHeight = 88;
const canvasPadding = 160;
const cardSpacing = 28;
const maxProjectionMonths = 240;
const balanceFloor = 0.01;
const dueDateSuggestionGapFloor = 100;
const dueDateSuggestionUtilizationFloor = 0.72;

type Theme = 'light' | 'dark';
type AuthMode = 'sign-in' | 'sign-up';
type InteractionMode = 'drag' | 'resize-x' | 'resize-y' | 'resize-xy';
type InteractionTarget = 'debt' | 'panel';
type SetupSection = 'home' | 'plan' | 'splits' | 'debts';

interface InteractionState {
  targetId: string;
  targetType: InteractionTarget;
  mode: InteractionMode;
  startX: number;
  startY: number;
  startLayout: Debt['layout'];
}

interface LayoutNode {
  targetId: string;
  targetType: InteractionTarget;
  collapsed: boolean;
  layout: Debt['layout'];
}

interface UpdaterState {
  canInstall: boolean;
  configured: boolean;
  message: string;
  percent?: number;
  status:
    | 'available'
    | 'checking'
    | 'dev-mode'
    | 'downloaded'
    | 'downloading'
    | 'error'
    | 'not-configured'
    | 'up-to-date';
  updatedAt: number;
  version?: string;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
});

const panelOrder: CanvasPanelId[] = [
  'overview',
  'summary',
  'controls',
  'signals',
  'splitLedger',
  'firstWindow',
  'secondWindow',
];

const splitBillCategories = [
  'Housing',
  'Utilities',
  'Internet',
  'Phone',
  'Transportation',
  'Insurance',
  'Groceries',
  'Subscriptions',
  'Healthcare',
  'Savings',
  'Personal',
  'Living',
  'Other',
];

const splitBillTypeOptions: Array<{ value: SplitBillKind; label: string }> = [
  { value: 'rent', label: 'Rent' },
  { value: 'utility', label: 'Utility' },
  { value: 'internet', label: 'Internet' },
  { value: 'phone', label: 'Phone' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'medical', label: 'Medical bill' },
  { value: 'credit-card', label: 'Credit card' },
  { value: 'personal-loan', label: 'Personal loan' },
  { value: 'auto-loan', label: 'Auto loan' },
  { value: 'student-loan', label: 'Student loan' },
  { value: 'line-of-credit', label: 'Line of credit' },
  { value: 'other', label: 'Other' },
];

const debtTypeOptions: Array<{ value: DebtKind; label: string }> = [
  { value: 'credit-card', label: 'Credit card' },
  { value: 'personal-loan', label: 'Personal loan' },
  { value: 'auto-loan', label: 'Auto loan' },
  { value: 'student-loan', label: 'Student loan' },
  { value: 'line-of-credit', label: 'Line of credit' },
  { value: 'medical-debt', label: 'Medical debt' },
  { value: 'other', label: 'Other' },
];

const movableSplitBillKinds = new Set<SplitBillKind>([
  'credit-card',
  'personal-loan',
  'auto-loan',
  'student-loan',
  'line-of-credit',
]);

const movableDebtKinds = new Set<DebtKind>([
  'credit-card',
  'personal-loan',
  'auto-loan',
  'student-loan',
  'line-of-credit',
]);

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: string, fallback: number) {
  const next = Number(value);
  if (Number.isNaN(next) || next < 0) {
    return fallback;
  }

  return next;
}

function sanitizeNumericDraft(value: string, allowDecimal: boolean) {
  const trimmed = value.replace(/[$,\s]/g, '');
  if (!allowDecimal) {
    return trimmed.replace(/[^\d]/g, '');
  }

  let result = '';
  let seenDot = false;

  for (const char of trimmed) {
    if (/\d/.test(char)) {
      result += char;
      continue;
    }

    if (char === '.' && !seenDot) {
      result += char;
      seenDot = true;
    }
  }

  return result;
}

interface NumberInputProps {
  disabled?: boolean;
  inputMode: 'decimal' | 'numeric';
  onValueChange: (next: number) => void;
  value: number;
}

function NumberInput({ disabled, inputMode, onValueChange, value }: NumberInputProps) {
  const allowDecimal = inputMode === 'decimal';
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      disabled={disabled}
      inputMode={inputMode}
      value={draft}
      onBlur={() => {
        const sanitized = sanitizeNumericDraft(draft, allowDecimal);
        if (!sanitized || sanitized === '.') {
          setDraft(String(value));
          return;
        }

        const parsed = Number(sanitized);
        if (Number.isNaN(parsed) || parsed < 0) {
          setDraft(String(value));
          return;
        }

        const nextValue = allowDecimal ? parsed : Math.round(parsed);
        setDraft(String(nextValue));
        onValueChange(nextValue);
      }}
      onChange={(event) => {
        const nextDraft = sanitizeNumericDraft(event.target.value, allowDecimal);
        if (nextDraft !== '' && !allowDecimal && /[^\d]/.test(nextDraft)) {
          return;
        }

        setDraft(nextDraft);

        if (!nextDraft || nextDraft.endsWith('.')) {
          return;
        }

        const parsed = Number(nextDraft);
        if (Number.isNaN(parsed) || parsed < 0) {
          return;
        }

        onValueChange(allowDecimal ? parsed : Math.round(parsed));
      }}
    />
  );
}

function snapToGrid(value: number) {
  return Math.round(value / gridSize) * gridSize;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSectionCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getRenderedHeight(layout: Debt['layout'], collapsed: boolean) {
  return collapsed ? collapsedHeight : layout.height;
}

function getDueWindowForDay(dueDay: number, cutoffDay: number): PayWindow {
  return dueDay <= cutoffDay ? 'first' : 'second';
}

function getSplitBillDueWindow(bill: SplitBill, cutoffDay: number): PayWindow | null {
  return typeof bill.dueDay === 'number' ? getDueWindowForDay(bill.dueDay, cutoffDay) : null;
}

function formatSplitBillDueDay(dueDay: number | null) {
  return typeof dueDay === 'number' ? `Due day ${dueDay}` : 'No due date';
}

function getSplitBillKindLabel(kind: SplitBillKind) {
  return splitBillTypeOptions.find((option) => option.value === kind)?.label ?? 'Other';
}

function getDebtKindLabel(kind: DebtKind) {
  return debtTypeOptions.find((option) => option.value === kind)?.label ?? 'Other';
}

function mapSplitBillKindToDebtKind(kind: SplitBillKind): DebtKind {
  switch (kind) {
    case 'credit-card':
    case 'personal-loan':
    case 'auto-loan':
    case 'student-loan':
    case 'line-of-credit':
      return kind;
    case 'medical':
      return 'medical-debt';
    default:
      return 'other';
  }
}

function canSuggestMovingSplitBillDueDate(bill: SplitBill) {
  return movableSplitBillKinds.has(bill.kind);
}

function canSuggestMovingDebtDueDate(debt: Debt) {
  return movableDebtKinds.has(debt.kind);
}

function getDueDateSuggestionCopy(label: string, typeLabel: string, amount: number) {
  if (typeLabel === 'Credit card' || typeLabel === 'Line of credit') {
    return `Consider asking the issuer to move ${label} to the second half. That would shift about ${money.format(amount)} away from paycheck 1 pressure.`;
  }

  if (
    typeLabel === 'Personal loan' ||
    typeLabel === 'Auto loan' ||
    typeLabel === 'Student loan' ||
    typeLabel === 'Medical debt'
  ) {
    return `Consider asking the lender to move ${label} to the second half. That would shift about ${money.format(amount)} away from paycheck 1 pressure.`;
  }

  return `Consider asking whether ${label} can be moved to the second half. That would shift about ${money.format(amount)} away from paycheck 1 pressure.`;
}

function getSplitBillMinimum(bill: SplitBill) {
  return bill.totalAmount > 0 ? bill.totalAmount : bill.firstWindowAmount + bill.secondWindowAmount;
}

function getSuggestedReliefAmountForSplitBill(bill: SplitBill) {
  return roundCurrency(Math.max(bill.firstWindowAmount, 0));
}

function getSuggestedReliefAmountForDebt(debt: Debt) {
  return roundCurrency(Math.max(debt.minimumPayment, 0));
}

function buildDebtFromSplitBill(debt: Debt, bill: SplitBill, cutoffDay: number): Partial<Debt> {
  const minimumPayment = roundCurrency(getSplitBillMinimum(bill));
  const nextDueDay = typeof bill.dueDay === 'number' ? bill.dueDay : debt.dueDay;

  return {
    kind: mapSplitBillKindToDebtKind(bill.kind),
    sourceSplitBillId: bill.id,
    name: bill.name,
    minimumPayment,
    dueDay: nextDueDay,
    dueWindow: getDueWindowForDay(nextDueDay, cutoffDay),
  };
}

function getEffectiveDebtRate(debt: Pick<Debt, 'apr' | 'interestRate'>) {
  return debt.apr > 0 ? debt.apr : debt.interestRate;
}

function formatDebtRateLabel(debt: Pick<Debt, 'apr' | 'interestRate'>) {
  if (debt.apr > 0) {
    return `${debt.apr}% APR`;
  }

  return `${debt.interestRate}% rate`;
}

function getSourceSplitBill(form: PlannerForm, debt: Debt) {
  if (!debt.sourceSplitBillId) {
    return null;
  }

  return form.splitBills.find((bill) => bill.id === debt.sourceSplitBillId) ?? null;
}

function getPayWindowTitles(payFrequency: PayFrequency) {
  switch (payFrequency) {
    case 'weekly':
      return {
        first: 'Pay Window 1',
        second: 'Pay Window 2',
        cadence: 'Weekly income planning',
      };
    case 'semi-monthly':
      return {
        first: 'Paycheck 1',
        second: 'Paycheck 2',
        cadence: 'Semi-monthly income planning',
      };
    case 'monthly':
      return {
        first: 'Early-month reserve',
        second: 'Late-month reserve',
        cadence: 'Monthly income planning',
      };
    case 'biweekly':
    default:
      return {
        first: 'Paycheck 1',
        second: 'Paycheck 2',
        cadence: 'Bi-weekly income planning',
      };
  }
}

function getNodeBottom(node: LayoutNode) {
  return node.layout.y + getRenderedHeight(node.layout, node.collapsed);
}

function getNodeRight(node: LayoutNode) {
  return node.layout.x + node.layout.width;
}

function getNodeTop(node: LayoutNode) {
  return node.layout.y;
}

function overlapsHorizontally(left: LayoutNode, right: LayoutNode) {
  return left.layout.x < getNodeRight(right) && getNodeRight(left) > right.layout.x;
}

function overlapsVertically(top: LayoutNode, bottom: LayoutNode) {
  return getNodeTop(top) < getNodeBottom(bottom) && getNodeBottom(top) > getNodeTop(bottom);
}

function nodesOverlap(left: LayoutNode, right: LayoutNode) {
  return overlapsHorizontally(left, right) && overlapsVertically(left, right);
}

function getHorizontalOverlap(left: LayoutNode, right: LayoutNode) {
  return Math.min(getNodeRight(left), getNodeRight(right)) - Math.max(left.layout.x, right.layout.x);
}

function getVerticalOverlap(top: LayoutNode, bottom: LayoutNode) {
  return Math.min(getNodeBottom(top), getNodeBottom(bottom)) - Math.max(getNodeTop(top), getNodeTop(bottom));
}

function shouldPreferHorizontalPush(motionX: number, motionY: number, overlapX: number, overlapY: number) {
  const absX = Math.abs(motionX);
  const absY = Math.abs(motionY);

  // If the contact is clearly happening on the left/right edge, keep the push horizontal.
  if (overlapX * 1.2 < overlapY) {
    return true;
  }

  // If the contact is clearly happening on the top/bottom edge, keep the push vertical.
  if (overlapY * 1.2 < overlapX) {
    return false;
  }

  if (absX > 0 && absY === 0) {
    return true;
  }

  if (absY > 0 && absX === 0) {
    return false;
  }

  // Bias toward the horizontal lane unless vertical motion is meaningfully stronger.
  if (absX >= absY * 0.85) {
    return true;
  }

  if (absY >= absX * 1.35) {
    return false;
  }

  return overlapX <= overlapY;
}

function buildGridLayout(index: number): Debt['layout'] {
  const width = 468;
  const height = 336;
  const column = index % 2;
  const row = Math.floor(index / 2);

  return {
    x: 64 + column * (width + 28),
    y: 340 + row * (height + 28),
    width,
    height,
    zIndex: index + 8,
  };
}

function clonePlan(form: PlannerForm): PlannerForm {
  return {
    ...form,
    income: { ...form.income },
    spending: { ...form.spending },
    splitBills: form.splitBills.map((bill) => ({ ...bill })),
    panels: Object.fromEntries(
      panelOrder.map((panelId) => [
        panelId,
        {
          collapsed: form.panels[panelId].collapsed,
          layout: { ...form.panels[panelId].layout },
        },
      ]),
    ) as PlannerForm['panels'],
    debts: form.debts.map((debt) => ({
      ...debt,
      collapsed: debt.collapsed,
      layout: { ...debt.layout },
    })),
  };
}

function createDebt(index: number): Debt {
  const dueDay = index % 2 === 0 ? 10 : 24;
  return {
    id: crypto.randomUUID(),
    name: `Debt ${index + 1}`,
    kind: 'credit-card',
    sourceSplitBillId: null,
    balance: 1500,
    apr: 19.9,
    interestRate: 18.9,
    minimumPayment: 75,
    dueDay,
    dueWindow: dueDay <= 15 ? 'first' : 'second',
    collapsed: false,
    layout: buildGridLayout(index),
  };
}

function createSplitBill(index: number): SplitBill {
  return {
    id: crypto.randomUUID(),
    name: `Bill ${index + 1}`,
    kind: 'other',
    category: 'Living',
    dueDay: index % 2 === 0 ? 1 : null,
    totalAmount: 200,
    firstWindowAmount: 100,
    secondWindowAmount: 100,
    notes: '',
  };
}

function normalizeLayout(rawLayout: unknown, fallback: Debt['layout']) {
  if (typeof rawLayout !== 'object' || rawLayout === null) {
    return fallback;
  }

  const layout = rawLayout as Partial<Debt['layout']>;

  return {
    x: typeof layout.x === 'number' ? layout.x : fallback.x,
    y: typeof layout.y === 'number' ? layout.y : fallback.y,
    width: typeof layout.width === 'number' ? layout.width : fallback.width,
    height: typeof layout.height === 'number' ? layout.height : fallback.height,
    zIndex: typeof layout.zIndex === 'number' ? layout.zIndex : fallback.zIndex,
  };
}

function normalizePanelState(rawPanel: unknown, fallback: CanvasPanelState): CanvasPanelState {
  if (typeof rawPanel !== 'object' || rawPanel === null) {
    return {
      collapsed: fallback.collapsed,
      layout: { ...fallback.layout },
    };
  }

  const panel = rawPanel as Partial<CanvasPanelState> & Partial<Debt['layout']>;
  const hasLegacyLayout =
    typeof panel.x === 'number' ||
    typeof panel.y === 'number' ||
    typeof panel.width === 'number' ||
    typeof panel.height === 'number';

  if (hasLegacyLayout) {
    return {
      collapsed: false,
      layout: normalizeLayout(panel, fallback.layout),
    };
  }

  return {
    collapsed: typeof panel.collapsed === 'boolean' ? panel.collapsed : fallback.collapsed,
    layout: normalizeLayout(panel.layout, fallback.layout),
  };
}

function normalizePlan(rawPlan: unknown): PlannerForm {
  if (typeof rawPlan !== 'object' || rawPlan === null) {
    return clonePlan(samplePlan);
  }

  const next = rawPlan as Partial<PlannerForm>;
  const debts = Array.isArray(next.debts) && next.debts.length > 0 ? next.debts : samplePlan.debts;
  const splitBills =
    Array.isArray(next.splitBills) && next.splitBills.length > 0 ? next.splitBills : samplePlan.splitBills;
  const nextPanels = typeof next.panels === 'object' && next.panels !== null ? next.panels : samplePlan.panels;

  return {
    planName: typeof next.planName === 'string' ? next.planName : samplePlan.planName,
    income: {
      payFrequency:
        next.income?.payFrequency === 'weekly' ||
        next.income?.payFrequency === 'semi-monthly' ||
        next.income?.payFrequency === 'monthly' ||
        next.income?.payFrequency === 'biweekly'
          ? next.income.payFrequency
          : samplePlan.income.payFrequency,
      firstPaycheckAmount:
        typeof next.income?.firstPaycheckAmount === 'number'
          ? next.income.firstPaycheckAmount
          : typeof (next.income as { firstWindowIncome?: number } | undefined)?.firstWindowIncome === 'number'
            ? (next.income as { firstWindowIncome: number }).firstWindowIncome
            : samplePlan.income.firstPaycheckAmount,
      secondPaycheckAmount:
        typeof next.income?.secondPaycheckAmount === 'number'
          ? next.income.secondPaycheckAmount
          : typeof (next.income as { secondWindowIncome?: number } | undefined)?.secondWindowIncome === 'number'
            ? (next.income as { secondWindowIncome: number }).secondWindowIncome
            : samplePlan.income.secondPaycheckAmount,
      extraIncome:
        typeof next.income?.extraIncome === 'number' ? next.income.extraIncome : samplePlan.income.extraIncome,
      windowCutoffDay:
        typeof next.income?.windowCutoffDay === 'number'
          ? next.income.windowCutoffDay
          : samplePlan.income.windowCutoffDay,
    },
    spending: {
      firstWindowPersonalSpend:
        typeof next.spending?.firstWindowPersonalSpend === 'number'
          ? next.spending.firstWindowPersonalSpend
          : samplePlan.spending.firstWindowPersonalSpend,
      secondWindowPersonalSpend:
        typeof next.spending?.secondWindowPersonalSpend === 'number'
          ? next.spending.secondWindowPersonalSpend
          : samplePlan.spending.secondWindowPersonalSpend,
    },
    splitBills: splitBills.map((rawBill, index) => {
      const bill = rawBill as Partial<SplitBill>;

      return {
        id: typeof bill.id === 'string' ? bill.id : crypto.randomUUID(),
        name: typeof bill.name === 'string' ? bill.name : `Bill ${index + 1}`,
        kind: typeof bill.kind === 'string' ? bill.kind : 'other',
        category: typeof bill.category === 'string' ? bill.category : 'Living',
        dueDay: typeof bill.dueDay === 'number' ? bill.dueDay : null,
        totalAmount: typeof bill.totalAmount === 'number' ? bill.totalAmount : 0,
        firstWindowAmount: typeof bill.firstWindowAmount === 'number' ? bill.firstWindowAmount : 0,
        secondWindowAmount: typeof bill.secondWindowAmount === 'number' ? bill.secondWindowAmount : 0,
        notes: typeof bill.notes === 'string' ? bill.notes : '',
      };
    }),
    panels: Object.fromEntries(
      panelOrder.map((panelId) => [panelId, normalizePanelState(nextPanels[panelId], samplePlan.panels[panelId])]),
    ) as PlannerForm['panels'],
    debts: debts.map((rawDebt, index) => {
      const debt = rawDebt as Partial<Debt>;

      return {
        id: typeof debt.id === 'string' ? debt.id : crypto.randomUUID(),
        name: typeof debt.name === 'string' ? debt.name : `Debt ${index + 1}`,
        kind: typeof debt.kind === 'string' ? debt.kind : 'other',
        sourceSplitBillId: typeof debt.sourceSplitBillId === 'string' ? debt.sourceSplitBillId : null,
        balance: typeof debt.balance === 'number' ? debt.balance : 0,
        apr: typeof debt.apr === 'number' ? debt.apr : 0,
        interestRate:
          typeof debt.interestRate === 'number'
            ? debt.interestRate
            : typeof debt.apr === 'number'
              ? debt.apr
              : 0,
        minimumPayment: typeof debt.minimumPayment === 'number' ? debt.minimumPayment : 0,
        dueDay:
          typeof debt.dueDay === 'number'
            ? debt.dueDay
            : debt.dueWindow === 'second'
              ? 25
              : 10,
        dueWindow:
          typeof debt.dueDay === 'number'
            ? getDueWindowForDay(debt.dueDay, typeof next.income?.windowCutoffDay === 'number' ? next.income.windowCutoffDay : samplePlan.income.windowCutoffDay)
            : debt.dueWindow === 'second'
              ? 'second'
              : 'first',
        collapsed: typeof debt.collapsed === 'boolean' ? debt.collapsed : false,
        layout: normalizeLayout(debt.layout, buildGridLayout(index)),
      };
    }),
  };
}

function getMonthLabel(offset: number) {
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  return monthFormatter.format(date);
}

function buildPlan(form: PlannerForm) {
  const balances = new Map(form.debts.map((debt) => [debt.id, debt.balance]));
  const debtRollups = new Map<string, DebtRollup>();
  const currentMonthDebtEntries: Array<{ id: string; label: string; dueWindow: PayWindow; amount: number }> =
    [];
  const currentMonthExtraPayments: Array<{ id: string; label: string; amount: number }> = [];
  let totalInterest = 0;
  let latestPayoffMonth: string | null = null;
  let currentMonthExtraCapacity = { first: 0, second: 0 };

  const payWindowTitles = getPayWindowTitles(form.income.payFrequency);
  const extraPerWindow = form.income.extraIncome / 2;
  const firstWindowIncome = roundCurrency(form.income.firstPaycheckAmount + extraPerWindow);
  const secondWindowIncome = roundCurrency(form.income.secondPaycheckAmount + extraPerWindow);
  const firstWindowSpend = roundCurrency(form.spending.firstWindowPersonalSpend);
  const secondWindowSpend = roundCurrency(form.spending.secondWindowPersonalSpend);
  const splitBillsWithWindow = form.splitBills.map((bill) => ({
    ...bill,
    dueWindow: getSplitBillDueWindow(bill, form.income.windowCutoffDay),
  }));
  const firstWindowSplitTotal = roundCurrency(
    splitBillsWithWindow.reduce((sum, bill) => sum + bill.firstWindowAmount, 0),
  );
  const secondWindowSplitTotal = roundCurrency(
    splitBillsWithWindow.reduce((sum, bill) => sum + bill.secondWindowAmount, 0),
  );

  for (const debt of form.debts) {
    const dueWindow = getDueWindowForDay(debt.dueDay, form.income.windowCutoffDay);
    debtRollups.set(debt.id, {
      debtId: debt.id,
      debtName: debt.name,
      apr: getEffectiveDebtRate(debt),
      startingBalance: debt.balance,
      dueWindow,
      minimumPayment: debt.minimumPayment,
      timeline: [],
      payoffMonth: null,
    });
  }

  for (let monthIndex = 0; monthIndex < maxProjectionMonths; monthIndex += 1) {
    const label = getMonthLabel(monthIndex);
    const activeDebts = form.debts.filter((debt) => (balances.get(debt.id) ?? 0) > balanceFloor);
    if (activeDebts.length === 0) {
      break;
    }

    const outstandingBeforePayments = activeDebts.reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0);
    const entries = activeDebts.map((debt) => {
      const startingBalance = balances.get(debt.id) ?? 0;
      const interest = roundCurrency((startingBalance * getEffectiveDebtRate(debt)) / 1200);
      const owedAtStart = roundCurrency(startingBalance + interest);

      totalInterest += interest;
      balances.set(debt.id, owedAtStart);

      return {
        debt,
        fundedBySplit: Boolean(getSourceSplitBill(form, debt)),
        interest,
        owedAtStart,
        payment: 0,
      };
    });

    const firstWindowMinimumDue = roundCurrency(
      entries
        .filter(
          (entry) =>
            getDueWindowForDay(entry.debt.dueDay, form.income.windowCutoffDay) === 'first' && !entry.fundedBySplit,
        )
        .reduce((sum, entry) => sum + Math.min(entry.debt.minimumPayment, entry.owedAtStart), 0),
    );
    const secondWindowMinimumDue = roundCurrency(
      entries
        .filter(
          (entry) =>
            getDueWindowForDay(entry.debt.dueDay, form.income.windowCutoffDay) === 'second' && !entry.fundedBySplit,
        )
        .reduce((sum, entry) => sum + Math.min(entry.debt.minimumPayment, entry.owedAtStart), 0),
    );
    const firstWindowExtraCapacity = roundCurrency(
      Math.max(0, firstWindowIncome - firstWindowSpend - firstWindowSplitTotal - firstWindowMinimumDue),
    );
    const secondWindowExtraCapacity = roundCurrency(
      Math.max(0, secondWindowIncome - secondWindowSpend - secondWindowSplitTotal - secondWindowMinimumDue),
    );
    let remainingBudget = roundCurrency(firstWindowExtraCapacity + secondWindowExtraCapacity);

    if (monthIndex === 0) {
      currentMonthExtraCapacity = {
        first: firstWindowExtraCapacity,
        second: secondWindowExtraCapacity,
      };
    }

    for (const entry of entries) {
      const minimumPayment = Math.min(entry.debt.minimumPayment, entry.owedAtStart);
      entry.payment = roundCurrency(minimumPayment);
      remainingBudget = roundCurrency(remainingBudget - entry.payment);
      balances.set(entry.debt.id, roundCurrency(entry.owedAtStart - entry.payment));
    }

    if (remainingBudget > 0) {
      const sortedByApr = [...entries].sort((left, right) => {
        const rightRate = getEffectiveDebtRate(right.debt);
        const leftRate = getEffectiveDebtRate(left.debt);

        if (rightRate !== leftRate) {
          return rightRate - leftRate;
        }

        return right.owedAtStart - left.owedAtStart;
      });

      for (const entry of sortedByApr) {
        if (remainingBudget <= 0) {
          break;
        }

        const currentBalance = balances.get(entry.debt.id) ?? 0;
        if (currentBalance <= 0.01) {
          continue;
        }

        const extraPayment = Math.min(currentBalance, remainingBudget);
        entry.payment = roundCurrency(entry.payment + extraPayment);
        remainingBudget = roundCurrency(remainingBudget - extraPayment);
        balances.set(entry.debt.id, roundCurrency(currentBalance - extraPayment));

        if (monthIndex === 0 && extraPayment > 0) {
          currentMonthExtraPayments.push({
            id: entry.debt.id,
            label: entry.debt.name,
            amount: extraPayment,
          });
        }
      }
    }

    let outstandingAfterPayments = 0;

    for (const entry of entries) {
      const remainingBalance = balances.get(entry.debt.id) ?? 0;
      const rollup = debtRollups.get(entry.debt.id);

      if (!rollup) {
        continue;
      }

      if (monthIndex === 0 && !entry.fundedBySplit) {
        currentMonthDebtEntries.push({
          id: entry.debt.id,
          label: entry.debt.name,
          dueWindow: getDueWindowForDay(entry.debt.dueDay, form.income.windowCutoffDay),
          amount: Math.min(entry.debt.minimumPayment, entry.owedAtStart),
        });
      }

      outstandingAfterPayments += remainingBalance;
      rollup.timeline.push({
        month: label,
        owed: entry.owedAtStart,
        paid: entry.payment,
        left: remainingBalance,
        percentLeft: entry.debt.balance > 0 ? remainingBalance / entry.debt.balance : 0,
      });

      if (remainingBalance <= balanceFloor && !rollup.payoffMonth) {
        rollup.payoffMonth = label;
        latestPayoffMonth = label;
      }
    }

    if (outstandingAfterPayments >= outstandingBeforePayments - balanceFloor) {
      break;
    }
  }

  const rollups = form.debts
    .map((debt) => debtRollups.get(debt.id))
    .filter((rollup): rollup is DebtRollup => Boolean(rollup));
  const focusDebt =
    [...form.debts].sort((left, right) => getEffectiveDebtRate(right) - getEffectiveDebtRate(left))[0] ?? null;
  const payoffMonth = rollups.every((rollup) => rollup.payoffMonth) ? latestPayoffMonth : null;
  const totalMinimums = form.debts.reduce((sum, debt) => sum + debt.minimumPayment, 0);
  const totalBalance = form.debts.reduce((sum, debt) => sum + debt.balance, 0);
  const totalIncome = form.income.firstPaycheckAmount + form.income.secondPaycheckAmount + form.income.extraIncome;
  const firstWindowDebtTotal = currentMonthDebtEntries
    .filter((entry) => entry.dueWindow === 'first')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const secondWindowDebtTotal = currentMonthDebtEntries
    .filter((entry) => entry.dueWindow === 'second')
    .reduce((sum, entry) => sum + entry.amount, 0);
  let remainingFirstExtra = currentMonthExtraCapacity.first;
  let remainingSecondExtra = currentMonthExtraCapacity.second;
  const firstWindowExtraItems: Array<{ id: string; label: string; amount: number }> = [];
  const secondWindowExtraItems: Array<{ id: string; label: string; amount: number }> = [];

  for (const extraPayment of currentMonthExtraPayments) {
    let remainingAmount = extraPayment.amount;

    if (remainingFirstExtra > 0) {
      const firstSlice = Math.min(remainingAmount, remainingFirstExtra);
      if (firstSlice > 0) {
        firstWindowExtraItems.push({
          id: `${extraPayment.id}-first-extra`,
          label: `Extra you could put toward ${extraPayment.label}`,
          amount: firstSlice,
        });
        remainingAmount = roundCurrency(remainingAmount - firstSlice);
        remainingFirstExtra = roundCurrency(remainingFirstExtra - firstSlice);
      }
    }

    if (remainingAmount > 0 && remainingSecondExtra > 0) {
      const secondSlice = Math.min(remainingAmount, remainingSecondExtra);
      if (secondSlice > 0) {
        secondWindowExtraItems.push({
          id: `${extraPayment.id}-second-extra`,
          label: `Extra you could put toward ${extraPayment.label}`,
          amount: secondSlice,
        });
        remainingAmount = roundCurrency(remainingAmount - secondSlice);
        remainingSecondExtra = roundCurrency(remainingSecondExtra - secondSlice);
      }
    }
  }

  const firstWindowExtraDebt = roundCurrency(firstWindowExtraItems.reduce((sum, item) => sum + item.amount, 0));
  const secondWindowExtraDebt = roundCurrency(secondWindowExtraItems.reduce((sum, item) => sum + item.amount, 0));
  const totalExtraDebt = roundCurrency(
    currentMonthExtraPayments.reduce((sum, extraPayment) => sum + extraPayment.amount, 0),
  );
  const firstWindowCarryTotal = roundCurrency(
    splitBillsWithWindow
      .filter((bill) => bill.dueWindow === 'second')
      .reduce((sum, bill) => sum + bill.firstWindowAmount, 0),
  );
  const secondWindowCarryTotal = roundCurrency(
    splitBillsWithWindow
      .filter((bill) => bill.dueWindow === 'first')
      .reduce((sum, bill) => sum + bill.secondWindowAmount, 0),
  );
  const firstWindowCommitted = roundCurrency(
    firstWindowSpend + firstWindowSplitTotal + firstWindowDebtTotal + firstWindowExtraDebt,
  );
  const secondWindowCommitted = roundCurrency(
    secondWindowSpend + secondWindowSplitTotal + secondWindowDebtTotal + secondWindowExtraDebt,
  );
  const firstWindowPressurePool = roundCurrency(firstWindowSplitTotal + firstWindowDebtTotal);
  const secondWindowPressurePool = roundCurrency(secondWindowSplitTotal + secondWindowDebtTotal);
  const dueDateCandidates = [
    ...splitBillsWithWindow.map((bill) => ({
      id: bill.id,
      label: bill.name,
      amount: getSuggestedReliefAmountForSplitBill(bill),
      typeLabel: getSplitBillKindLabel(bill.kind),
      dueWindow: bill.dueWindow,
      movable: canSuggestMovingSplitBillDueDate(bill),
      sourceType: 'split' as const,
    })),
    ...form.debts
      .filter((debt) => !getSourceSplitBill(form, debt))
      .map((debt) => ({
        id: debt.id,
        label: debt.name,
        amount: getSuggestedReliefAmountForDebt(debt),
        typeLabel: getDebtKindLabel(debt.kind),
        dueWindow: getDueWindowForDay(debt.dueDay, form.income.windowCutoffDay),
        movable: canSuggestMovingDebtDueDate(debt),
        sourceType: 'debt' as const,
      })),
  ];
  const firstWindowCoverageGap = roundCurrency(Math.max(0, firstWindowCommitted - firstWindowIncome));
  const firstWindowPressureGap = roundCurrency(Math.max(0, firstWindowPressurePool - secondWindowPressurePool));
  const firstWindowUtilization =
    firstWindowIncome > 0 ? roundCurrency(firstWindowCommitted / firstWindowIncome) : firstWindowCommitted > 0 ? 1 : 0;
  const hasImbalancedPressure =
    firstWindowPressureGap >= dueDateSuggestionGapFloor ||
    (firstWindowPressureGap > 0 && firstWindowUtilization >= dueDateSuggestionUtilizationFloor);
  const fixedFirstWindowItems = dueDateCandidates
    .filter((candidate) => candidate.dueWindow === 'first' && !candidate.movable && candidate.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);
  const movableDueDateCandidates = dueDateCandidates
    .filter((candidate) => candidate.dueWindow === 'first' && candidate.movable && candidate.amount > 0)
    .sort((left, right) => {
      if (right.amount !== left.amount) {
        return right.amount - left.amount;
      }

      if (left.sourceType !== right.sourceType) {
        return left.sourceType === 'split' ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });
  const hasMovableFirstWindowItems = movableDueDateCandidates.length > 0;
  const hasFirstWindowPressureIssue = firstWindowCoverageGap > 0 || hasImbalancedPressure;
  const firstWindowImbalanceGap = roundCurrency(Math.max(0, firstWindowPressureGap / 2));
  const suggestionTargetRelief = roundCurrency(Math.max(firstWindowCoverageGap, firstWindowImbalanceGap));
  const dueDateSuggestions = hasFirstWindowPressureIssue && hasMovableFirstWindowItems
    ? movableDueDateCandidates.reduce<
        Array<
          (typeof movableDueDateCandidates)[number] & {
            copy: string;
          }
        >
      >((suggestions, candidate) => {
        const relievedSoFar = suggestions.reduce((sum, suggestion) => sum + suggestion.amount, 0);
        if (suggestions.length >= 3 || relievedSoFar >= suggestionTargetRelief) {
          return suggestions;
        }

        return [
          ...suggestions,
          {
            ...candidate,
            copy: getDueDateSuggestionCopy(candidate.label, candidate.typeLabel, candidate.amount),
          },
        ];
      }, [])
    : [];

  const firstWindow: WindowAllocation = {
    title: payWindowTitles.first,
    income: firstWindowIncome,
    spend: firstWindowSpend,
    reserve: firstWindowSplitTotal,
    debtPayments: roundCurrency(firstWindowDebtTotal + firstWindowExtraDebt),
    minimumDebtPayments: roundCurrency(firstWindowDebtTotal),
    extraDebtPayments: roundCurrency(firstWindowExtraDebt),
    committed: firstWindowCommitted,
    left: roundCurrency(firstWindowIncome - firstWindowCommitted),
    items: [
      {
        id: 'income-first',
        label: `${payWindowTitles.first} deposit`,
        amount: form.income.firstPaycheckAmount,
        type: 'income',
      },
      ...(extraPerWindow > 0
        ? [{ id: 'income-extra-first', label: 'Extra income share', amount: extraPerWindow, type: 'income' as const }]
        : []),
      {
        id: 'spend-first',
        label: 'Personal spend reserve',
        amount: firstWindowSpend,
        type: 'spend' as const,
      },
      ...splitBillsWithWindow
        .filter((bill) => bill.firstWindowAmount > 0)
        .map((bill) => ({
          id: bill.id,
          label:
            bill.dueWindow === null
              ? `${bill.name} allocation`
              : bill.dueWindow === 'second'
              ? `${bill.name} reserve carried into paycheck 2`
              : `${bill.name} funded in paycheck 1`,
          amount: bill.firstWindowAmount,
          type: (bill.dueWindow === 'second' ? 'carry' : 'bill') as const,
        })),
      ...currentMonthDebtEntries
        .filter((entry) => entry.dueWindow === 'first')
        .map((entry) => ({
          id: entry.id,
          label: `${entry.label} minimum due`,
          amount: entry.amount,
          type: 'debt' as const,
        })),
      ...firstWindowExtraItems.map((item) => ({
        ...item,
        type: 'debt' as const,
      })),
    ],
  };

  const secondWindow: WindowAllocation = {
    title: payWindowTitles.second,
    income: secondWindowIncome,
    spend: secondWindowSpend,
    reserve: secondWindowSplitTotal,
    debtPayments: roundCurrency(secondWindowDebtTotal + secondWindowExtraDebt),
    minimumDebtPayments: roundCurrency(secondWindowDebtTotal),
    extraDebtPayments: roundCurrency(secondWindowExtraDebt),
    committed: secondWindowCommitted,
    left: roundCurrency(secondWindowIncome - secondWindowCommitted),
    items: [
      {
        id: 'income-second',
        label: `${payWindowTitles.second} deposit`,
        amount: form.income.secondPaycheckAmount,
        type: 'income',
      },
      ...(extraPerWindow > 0
        ? [{ id: 'income-extra-second', label: 'Extra income share', amount: extraPerWindow, type: 'income' as const }]
        : []),
      {
        id: 'spend-second',
        label: 'Personal spend reserve',
        amount: secondWindowSpend,
        type: 'spend' as const,
      },
      ...splitBillsWithWindow
        .filter((bill) => bill.secondWindowAmount > 0)
        .map((bill) => ({
          id: bill.id,
          label:
            bill.dueWindow === null
              ? `${bill.name} allocation`
              : bill.dueWindow === 'first'
              ? `${bill.name} reset for next cycle`
              : `${bill.name} due in paycheck 2`,
          amount: bill.secondWindowAmount,
          type: (bill.dueWindow === 'first' ? 'carry' : 'bill') as const,
        })),
      ...currentMonthDebtEntries
        .filter((entry) => entry.dueWindow === 'second')
        .map((entry) => ({
          id: entry.id,
          label: `${entry.label} minimum due`,
          amount: entry.amount,
          type: 'debt' as const,
        })),
      ...secondWindowExtraItems.map((item) => ({
        ...item,
        type: 'debt' as const,
      })),
    ],
  };

  return {
    rollups,
    focusDebt,
    payoffMonth,
    totalIncome: roundCurrency(totalIncome),
    totalInterest: roundCurrency(totalInterest),
    totalMinimums: roundCurrency(totalMinimums),
    totalBalance: roundCurrency(totalBalance),
    totalReserved: roundCurrency(firstWindowSplitTotal + secondWindowSplitTotal),
    totalExtraDebt,
    dueDateSuggestions,
    hasFirstWindowPressureIssue,
    suggestionTargetRelief,
    fixedFirstWindowItems,
    firstWindowCoverageGap,
    firstWindowCarryTotal,
    secondWindowCarryTotal,
    firstWindowPressurePool,
    secondWindowPressurePool,
    payWindowTitles,
    firstWindow,
    secondWindow,
  };
}

function updateDebt(form: PlannerForm, debtId: string, patch: Partial<Debt>) {
  return {
    ...form,
    debts: form.debts.map((debt) => (debt.id === debtId ? { ...debt, ...patch } : debt)),
  };
}

function updateSplitBill(form: PlannerForm, billId: string, patch: Partial<SplitBill>) {
  return {
    ...form,
    splitBills: form.splitBills.map((bill) => (bill.id === billId ? { ...bill, ...patch } : bill)),
  };
}

function getHighestZ(form: PlannerForm) {
  const highestDebt = form.debts.reduce((max, debt) => Math.max(max, debt.layout.zIndex), 0);
  const highestPanel = panelOrder.reduce((max, panelId) => Math.max(max, form.panels[panelId].layout.zIndex), 0);

  return Math.max(highestDebt, highestPanel);
}

function getLayoutNode(form: PlannerForm, targetType: InteractionTarget, targetId: string): LayoutNode | null {
  if (targetType === 'panel') {
    const panel = form.panels[targetId as CanvasPanelId];
    if (!panel) {
      return null;
    }

    return {
      targetId,
      targetType,
      collapsed: panel.collapsed,
      layout: panel.layout,
    };
  }

  const debt = form.debts.find((item) => item.id === targetId);
  if (!debt) {
    return null;
  }

  return {
    targetId,
    targetType,
    collapsed: debt.collapsed,
    layout: debt.layout,
  };
}

function getAllLayoutNodes(form: PlannerForm) {
  const panelNodes = panelOrder.map((panelId) => ({
    targetId: panelId,
    targetType: 'panel' as const,
    collapsed: form.panels[panelId].collapsed,
    layout: form.panels[panelId].layout,
  }));
  const debtNodes = form.debts.map((debt) => ({
    targetId: debt.id,
    targetType: 'debt' as const,
    collapsed: debt.collapsed,
    layout: debt.layout,
  }));

  return [...panelNodes, ...debtNodes];
}

function setTargetLayout(
  form: PlannerForm,
  targetType: InteractionTarget,
  targetId: string,
  layout: Debt['layout'],
) {
  if (targetType === 'panel') {
    return {
      ...form,
      panels: {
        ...form.panels,
        [targetId]: {
          ...form.panels[targetId as CanvasPanelId],
          layout,
        },
      },
    };
  }

  return {
    ...form,
    debts: form.debts.map((debt) => (debt.id === targetId ? { ...debt, layout } : debt)),
  };
}

function resolveCollisions(
  form: PlannerForm,
  sourceType: InteractionTarget,
  sourceId: string,
  motion: { x: number; y: number } = { x: 0, y: 1 },
): PlannerForm {
  let nextForm = form;
  const queue: Array<{ targetType: InteractionTarget; targetId: string; motion: { x: number; y: number } }> = [
    { targetType: sourceType, targetId: sourceId, motion },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const sourceNode = getLayoutNode(nextForm, current.targetType, current.targetId);
    if (!sourceNode) {
      continue;
    }

    const candidates = getAllLayoutNodes(nextForm)
      .filter((node) => !(node.targetType === sourceNode.targetType && node.targetId === sourceNode.targetId))
      .sort((left, right) => {
        const leftDistance =
          Math.abs(left.layout.x - sourceNode.layout.x) + Math.abs(left.layout.y - sourceNode.layout.y);
        const rightDistance =
          Math.abs(right.layout.x - sourceNode.layout.x) + Math.abs(right.layout.y - sourceNode.layout.y);

        return leftDistance - rightDistance;
      });

    for (const node of candidates) {
      if (!nodesOverlap(sourceNode, node)) {
        continue;
      }

      const overlapX = getHorizontalOverlap(sourceNode, node);
      const overlapY = getVerticalOverlap(sourceNode, node);
      if (overlapX <= 0 || overlapY <= 0) {
        continue;
      }

      const motionX = current.motion.x;
      const motionY = current.motion.y;
      const preferX = shouldPreferHorizontalPush(motionX, motionY, overlapX, overlapY);
      const directionX = motionX === 0 ? (sourceNode.layout.x <= node.layout.x ? 1 : -1) : motionX > 0 ? 1 : -1;
      const directionY = motionY === 0 ? (sourceNode.layout.y <= node.layout.y ? 1 : -1) : motionY > 0 ? 1 : -1;
      const horizontalShift = snapToGrid(overlapX + cardSpacing);
      const verticalShift = snapToGrid(overlapY + cardSpacing);
      let nextLayout = { ...node.layout };
      let nextMotion = { x: 0, y: 0 };

      if (preferX) {
        nextLayout.x = clamp(node.layout.x + horizontalShift * directionX, 24, 8000);
        nextMotion = { x: horizontalShift * directionX, y: 0 };

        if (nextLayout.x === node.layout.x) {
          nextLayout.y = clamp(node.layout.y + verticalShift * directionY, 24, 8000);
          nextMotion = { x: 0, y: verticalShift * directionY };
        }
      } else {
        nextLayout.y = clamp(node.layout.y + verticalShift * directionY, 24, 8000);
        nextMotion = { x: 0, y: verticalShift * directionY };

        if (nextLayout.y === node.layout.y) {
          nextLayout.x = clamp(node.layout.x + horizontalShift * directionX, 24, 8000);
          nextMotion = { x: horizontalShift * directionX, y: 0 };
        }
      }

      nextForm = setTargetLayout(nextForm, node.targetType, node.targetId, {
        ...node.layout,
        ...nextLayout,
      });

      queue.push({
        targetType: node.targetType,
        targetId: node.targetId,
        motion: nextMotion,
      });
    }
  }

  return nextForm;
}

function bringToFront(form: PlannerForm, targetType: InteractionTarget, targetId: string) {
  const nextZ = getHighestZ(form) + 1;

  if (targetType === 'panel') {
    return {
      ...form,
      panels: {
        ...form.panels,
        [targetId]: {
          ...form.panels[targetId as CanvasPanelId],
          layout: {
            ...form.panels[targetId as CanvasPanelId].layout,
            zIndex: nextZ,
          },
        },
      },
    };
  }

  return {
    ...form,
    debts: form.debts.map((debt) =>
      debt.id === targetId
        ? {
            ...debt,
            layout: {
              ...debt.layout,
              zIndex: nextZ,
            },
          }
        : debt,
    ),
  };
}

function toggleCollapse(form: PlannerForm, targetType: InteractionTarget, targetId: string) {
  if (targetType === 'panel') {
    const nextForm = {
      ...form,
      panels: {
        ...form.panels,
        [targetId]: {
          ...form.panels[targetId as CanvasPanelId],
          collapsed: !form.panels[targetId as CanvasPanelId].collapsed,
        },
      },
    };

    return resolveCollisions(nextForm, targetType, targetId, { x: 0, y: 1 });
  }

  const nextForm = {
    ...form,
    debts: form.debts.map((debt) =>
      debt.id === targetId ? { ...debt, collapsed: !debt.collapsed } : debt,
    ),
  };

  return resolveCollisions(nextForm, targetType, targetId, { x: 0, y: 1 });
}

function getCanvasSize(form: PlannerForm) {
  const debtRight = form.debts.reduce((max, debt) => Math.max(max, debt.layout.x + debt.layout.width), 0);
  const debtBottom = form.debts.reduce(
    (max, debt) => Math.max(max, debt.layout.y + getRenderedHeight(debt.layout, debt.collapsed)),
    0,
  );
  const panelRight = panelOrder.reduce(
    (max, panelId) => Math.max(max, form.panels[panelId].layout.x + form.panels[panelId].layout.width),
    0,
  );
  const panelBottom = panelOrder.reduce(
    (max, panelId) =>
      Math.max(
        max,
        form.panels[panelId].layout.y +
          getRenderedHeight(form.panels[panelId].layout, form.panels[panelId].collapsed),
      ),
    0,
  );

  return {
    width: Math.max(2600, debtRight, panelRight) + canvasPadding,
    height: Math.max(1800, debtBottom, panelBottom) + canvasPadding,
  };
}

function resetCanvasLayout(form: PlannerForm) {
  return {
    ...form,
    panels: Object.fromEntries(
      panelOrder.map((panelId) => [
        panelId,
        {
          ...form.panels[panelId],
          layout: { ...samplePlan.panels[panelId].layout },
        },
      ]),
    ) as PlannerForm['panels'],
    debts: form.debts.map((debt, index) => {
      const nextLayout = buildGridLayout(index);
      return {
        ...debt,
        layout: {
          ...debt.layout,
          x: nextLayout.x,
          y: nextLayout.y,
          zIndex: nextLayout.zIndex,
        },
      };
    }),
  };
}

function getTargetLayout(form: PlannerForm, targetType: InteractionTarget, targetId: string) {
  if (targetType === 'panel') {
    return form.panels[targetId as CanvasPanelId].layout;
  }

  return form.debts.find((debt) => debt.id === targetId)?.layout ?? null;
}

interface EditorModalProps {
  form: PlannerForm;
  isOpen: boolean;
  onClose: () => void;
  onChange: (next: PlannerForm) => void;
  onAddSplitItem: () => string;
  onAddDebtModel: () => string;
}

function EditorModal({
  form,
  isOpen,
  onClose,
  onChange,
  onAddSplitItem,
  onAddDebtModel,
}: EditorModalProps) {
  const [activeSection, setActiveSection] = useState<SetupSection>('home');
  const [selectedSplitId, setSelectedSplitId] = useState<string | null>(form.splitBills[0]?.id ?? null);
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(form.debts[0]?.id ?? null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!form.splitBills.some((bill) => bill.id === selectedSplitId)) {
      setSelectedSplitId(form.splitBills[0]?.id ?? null);
    }
  }, [form.splitBills, isOpen, selectedSplitId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!form.debts.some((debt) => debt.id === selectedDebtId)) {
      setSelectedDebtId(form.debts[0]?.id ?? null);
    }
  }, [form.debts, isOpen, selectedDebtId]);

  if (!isOpen) {
    return null;
  }

  const selectedSplit = form.splitBills.find((bill) => bill.id === selectedSplitId) ?? form.splitBills[0] ?? null;
  const selectedDebt = form.debts.find((debt) => debt.id === selectedDebtId) ?? form.debts[0] ?? null;
  const splitCategoryOptions = [...new Set([...splitBillCategories, ...form.splitBills.map((bill) => bill.category)])];
  const splitCoverageTotal = form.splitBills.reduce(
    (sum, bill) => sum + bill.firstWindowAmount + bill.secondWindowAmount,
    0,
  );
  const debtBalanceTotal = form.debts.reduce((sum, debt) => sum + debt.balance, 0);
  const renderSectionHeader = (
    eyebrow: string,
    title: string,
    copy: string,
    actions?: React.ReactNode,
  ) => (
    <div className="setup-page-header">
      <div className="setup-page-copy">
        <button
          className="back-button"
          onClick={() => {
            setActiveSection('home');
          }}
          type="button"
        >
          ← Back to setup home
        </button>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
      {actions ? <div className="setup-page-actions">{actions}</div> : null}
    </div>
  );

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        onClose();
      }}
    >
      <section
        className="editor-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="modal-header">
          <div className="modal-heading">
            <p className="eyebrow">Workspace setup</p>
            <h2>Income, bill routing, and debt tracking</h2>
            <p className="modal-copy">
              Set up the workspace here, then return to the canvas and arrange each card the way you want it.
            </p>
          </div>
          <div className="modal-actions">
            <button className="icon-button" onClick={onClose} type="button">
              ×
            </button>
          </div>
        </div>

        <div className="setup-stage">
          {activeSection === 'home' ? (
            <section className="setup-home">
              <div className="setup-home-hero modal-panel">
                <div className="setup-home-copy">
                  <p className="eyebrow">Workspace</p>
                  <h3>Choose what you want to manage</h3>
                  <p>
                    Each area opens as its own setup page, so creating new split items and debt models is
                    separate from editing existing ones.
                  </p>
                </div>

                <div className="setup-home-stats">
                  <div>
                    <span>Pay cycle</span>
                    <strong>{getPayWindowTitles(form.income.payFrequency).cadence}</strong>
                  </div>
                  <div>
                    <span>Split coverage</span>
                    <strong>{money.format(splitCoverageTotal)}</strong>
                  </div>
                  <div>
                    <span>Total debt tracked</span>
                    <strong>{money.format(debtBalanceTotal)}</strong>
                  </div>
                </div>
              </div>

              <div className="setup-home-grid">
                <button
                  className="setup-home-card modal-panel"
                  onClick={() => {
                    setActiveSection('plan');
                  }}
                  type="button"
                >
                  <p className="eyebrow">Income & timing</p>
                  <h3>Paycheck planning</h3>
                  <p>Adjust pay frequency, cutoff day, paycheck amounts, and the spend reserves that shape payoff.</p>
                  <div className="setup-home-meta">
                    <span>{money.format(form.income.firstPaycheckAmount + form.income.secondPaycheckAmount)}</span>
                    <small>Monthly paycheck base</small>
                  </div>
                </button>

                <button
                  className="setup-home-card modal-panel"
                  onClick={() => {
                    setActiveSection('splits');
                  }}
                  type="button"
                >
                  <p className="eyebrow">Split models</p>
                  <h3>Bill split library</h3>
                  <p>Review current split items, add new ones, and edit one selected item at a time.</p>
                  <div className="setup-home-meta">
                    <span>{formatSectionCount(form.splitBills.length, 'item', 'items')}</span>
                    <small>Reserved across both paycheck windows</small>
                  </div>
                </button>

                <button
                  className="setup-home-card modal-panel"
                  onClick={() => {
                    setActiveSection('debts');
                  }}
                  type="button"
                >
                  <p className="eyebrow">Debt models</p>
                  <h3>Debt card library</h3>
                  <p>Open a dedicated debt-management page to create, edit, or remove debt models cleanly.</p>
                  <div className="setup-home-meta">
                    <span>{formatSectionCount(form.debts.length, 'debt card', 'debt cards')}</span>
                    <small>Visible on the canvas after setup closes</small>
                  </div>
                </button>
              </div>
            </section>
          ) : null}

          {activeSection === 'plan' ? (
            <>
              {renderSectionHeader(
                'Income & timing',
                'Paycheck planning',
                'Set the rules that split the month into two paycheck windows. The app uses income, spend reserves, and split bills to figure out how much room is left for debt payoff, then keeps projecting until payoff.',
              )}
              <div className="modal-grid modal-grid-plan">
                <section className="modal-panel">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">Plan</p>
                      <h3>Income and timing</h3>
                    </div>
                  </div>

                  <label className="field field-full">
                    <span>Plan name</span>
                    <input
                      value={form.planName}
                      onChange={(event) => {
                        onChange({ ...form, planName: event.target.value });
                      }}
                    />
                  </label>

                  <div className="field-grid field-grid-tight">
                    <label className="field">
                      <span>Pay frequency</span>
                      <select
                        value={form.income.payFrequency}
                        onChange={(event) => {
                          onChange({
                            ...form,
                            income: {
                              ...form.income,
                              payFrequency: event.target.value as PlannerForm['income']['payFrequency'],
                            },
                          });
                        }}
                      >
                        <option value="biweekly">Bi-weekly</option>
                        <option value="weekly">Weekly</option>
                        <option value="semi-monthly">Semi-monthly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Split cutoff day</span>
                      <NumberInput
                        inputMode="numeric"
                        value={form.income.windowCutoffDay}
                        onValueChange={(nextValue) => {
                          onChange({
                            ...form,
                            income: {
                              ...form.income,
                              windowCutoffDay: Math.max(7, Math.min(25, nextValue)),
                            },
                          });
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Paycheck 1 amount</span>
                      <NumberInput
                        inputMode="decimal"
                        value={form.income.firstPaycheckAmount}
                        onValueChange={(nextValue) => {
                          onChange({
                            ...form,
                            income: {
                              ...form.income,
                              firstPaycheckAmount: nextValue,
                            },
                          });
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Paycheck 2 amount</span>
                      <NumberInput
                        inputMode="decimal"
                        value={form.income.secondPaycheckAmount}
                        onValueChange={(nextValue) => {
                          onChange({
                            ...form,
                            income: {
                              ...form.income,
                              secondPaycheckAmount: nextValue,
                            },
                          });
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Extra monthly income</span>
                      <NumberInput
                        inputMode="decimal"
                        value={form.income.extraIncome}
                        onValueChange={(nextValue) => {
                          onChange({
                            ...form,
                            income: {
                              ...form.income,
                              extraIncome: nextValue,
                            },
                          });
                        }}
                      />
                    </label>
                  </div>
                </section>

                <section className="modal-panel">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">Spend reserve</p>
                      <h3>Everyday spending by paycheck</h3>
                    </div>
                  </div>

                  <div className="field-grid field-grid-tight">
                    <label className="field">
                      <span>Paycheck 1 personal spend</span>
                      <NumberInput
                        inputMode="decimal"
                        value={form.spending.firstWindowPersonalSpend}
                        onValueChange={(nextValue) => {
                          onChange({
                            ...form,
                            spending: {
                              ...form.spending,
                              firstWindowPersonalSpend: nextValue,
                            },
                          });
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Paycheck 2 personal spend</span>
                      <NumberInput
                        inputMode="decimal"
                        value={form.spending.secondWindowPersonalSpend}
                        onValueChange={(nextValue) => {
                          onChange({
                            ...form,
                            spending: {
                              ...form.spending,
                              secondWindowPersonalSpend: nextValue,
                            },
                          });
                        }}
                      />
                    </label>
                    <div className="metric-card field-span-2">
                      <span>How it works</span>
                      <strong>Debt payoff is now whatever remains after spend reserves and bill splits.</strong>
                    </div>
                  </div>
                </section>
              </div>
            </>
          ) : null}

          {activeSection === 'splits' ? (
            <>
              {renderSectionHeader(
                'Split models',
                'Bill split library',
                'Create and manage bill splits here. Select one item from the list to edit its details. Creating a new item does not save the current one; it opens a fresh record.',
                <button
                  className="primary-button"
                  onClick={() => {
                    const id = onAddSplitItem();
                    setSelectedSplitId(id);
                  }}
                  type="button"
                >
                  New split item
                </button>,
              )}
              <div className="record-shell">
                <section className="record-list-panel modal-panel">
                  <div className="record-panel-header">
                    <div>
                      <p className="eyebrow">Library</p>
                      <h3>Existing split items</h3>
                      <p>Choose an item to edit it. The list on the left is your saved split library.</p>
                    </div>
                    <div className="record-count-pill">{formatSectionCount(form.splitBills.length, 'item', 'items')}</div>
                  </div>

                  <div className="record-list">
                    {form.splitBills.map((bill) => (
                      <button
                        className={`record-list-item${selectedSplit?.id === bill.id ? ' is-active' : ''}`}
                        key={bill.id}
                        onClick={() => {
                          setSelectedSplitId(bill.id);
                        }}
                        type="button"
                      >
                        <strong>{bill.name}</strong>
                        <span>{getSplitBillKindLabel(bill.kind)} · {formatSplitBillDueDay(bill.dueDay)}</span>
                        <small>
                          {money.format(bill.firstWindowAmount)} / {money.format(bill.secondWindowAmount)}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="record-editor-panel modal-panel">
                  {selectedSplit ? (
                    <>
                      <div className="record-panel-header">
                        <div>
                          <p className="eyebrow">Selected split item</p>
                          <h3>{selectedSplit.name}</h3>
                          <p>Adjust the amount that should be reserved from paycheck 1 and paycheck 2.</p>
                        </div>
                      </div>

                      <article
                        className="split-editor-card"
                        data-editor-target={`split-${selectedSplit.id}`}
                      >
                        <div className="field-grid debt-topline">
                          <label className="field">
                            <span>Name</span>
                            <input
                              value={selectedSplit.name}
                              onChange={(event) => {
                                onChange(updateSplitBill(form, selectedSplit.id, { name: event.target.value }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>Category</span>
                            <select
                              value={selectedSplit.category}
                              onChange={(event) => {
                                onChange(updateSplitBill(form, selectedSplit.id, { category: event.target.value }));
                              }}
                            >
                              {splitCategoryOptions.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="field-grid field-grid-tight">
                          <label className="field">
                            <span>Type</span>
                            <select
                              value={selectedSplit.kind}
                              onChange={(event) => {
                                onChange(
                                  updateSplitBill(form, selectedSplit.id, {
                                    kind: event.target.value as SplitBillKind,
                                  }),
                                );
                              }}
                            >
                              {splitBillTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="metric-card">
                            <span>Suggestion logic</span>
                            <strong>
                              {canSuggestMovingSplitBillDueDate(selectedSplit)
                                ? 'Can suggest due-date move'
                                : 'Fixed or non-movable'}
                            </strong>
                          </div>
                        </div>

                        <div className="field-grid split-grid">
                          <label className="field">
                            <span>Total amount</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedSplit.totalAmount}
                              onValueChange={(nextValue) => {
                                onChange(updateSplitBill(form, selectedSplit.id, { totalAmount: nextValue }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>Paycheck 1 reserve</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedSplit.firstWindowAmount}
                              onValueChange={(nextValue) => {
                                onChange(updateSplitBill(form, selectedSplit.id, { firstWindowAmount: nextValue }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>Paycheck 2 reserve</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedSplit.secondWindowAmount}
                              onValueChange={(nextValue) => {
                                onChange(updateSplitBill(form, selectedSplit.id, { secondWindowAmount: nextValue }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>Timing</span>
                            <select
                              value={selectedSplit.dueDay === null ? 'none' : 'dated'}
                              onChange={(event) => {
                                onChange(
                                  updateSplitBill(form, selectedSplit.id, {
                                    dueDay: event.target.value === 'none' ? null : selectedSplit.dueDay ?? 15,
                                  }),
                                );
                              }}
                            >
                              <option value="dated">Has due date</option>
                              <option value="none">No due date</option>
                            </select>
                          </label>
                        </div>

                        <div className="field-grid field-grid-tight">
                          <label className="field">
                            <span>Due day</span>
                            <NumberInput
                              disabled={selectedSplit.dueDay === null}
                              inputMode="numeric"
                              value={selectedSplit.dueDay ?? 15}
                              onValueChange={(nextValue) => {
                                onChange(
                                  updateSplitBill(form, selectedSplit.id, {
                                    dueDay: Math.max(1, Math.min(31, nextValue)),
                                  }),
                                );
                              }}
                            />
                          </label>
                          <div className="metric-card">
                            <span>Due-date handling</span>
                            <strong>
                              {selectedSplit.dueDay === null
                                ? 'Flexible allocation'
                                : `Falls in ${
                                    getDueWindowForDay(selectedSplit.dueDay, form.income.windowCutoffDay) === 'first'
                                      ? 'paycheck 1'
                                      : 'paycheck 2'
                                  }`}
                            </strong>
                          </div>
                        </div>

                        <label className="field field-full">
                          <span>Notes</span>
                          <input
                            value={selectedSplit.notes}
                            onChange={(event) => {
                              onChange(updateSplitBill(form, selectedSplit.id, { notes: event.target.value }));
                            }}
                          />
                        </label>

                        <button
                          className="text-button"
                          disabled={form.splitBills.length === 1}
                          onClick={() => {
                            const remaining = form.splitBills.filter((item) => item.id !== selectedSplit.id);
                            onChange({
                              ...form,
                              splitBills: remaining,
                            });
                            setSelectedSplitId(remaining[0]?.id ?? null);
                          }}
                          type="button"
                        >
                          Remove this split item
                        </button>
                      </article>
                    </>
                  ) : (
                    <div className="record-empty-state">
                      <p className="eyebrow">No selection</p>
                      <h3>Create your first split item</h3>
                      <p>Start with a rent, utility, or other monthly bill you want to divide across paychecks.</p>
                      <button
                        className="primary-button"
                        onClick={() => {
                          const id = onAddSplitItem();
                          setSelectedSplitId(id);
                        }}
                        type="button"
                      >
                        New split item
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : null}

          {activeSection === 'debts' ? (
            <>
              {renderSectionHeader(
                'Debt models',
                'Debt card library',
                'Manage the debt cards that appear on the canvas. Pick a debt from the list to edit it, or create a new one from here.',
                <button
                  className="primary-button"
                  onClick={() => {
                    const id = onAddDebtModel();
                    setSelectedDebtId(id);
                  }}
                  type="button"
                >
                  New debt model
                </button>,
              )}
              <div className="record-shell">
                <section className="record-list-panel modal-panel">
                  <div className="record-panel-header">
                    <div>
                      <p className="eyebrow">Library</p>
                      <h3>Existing debt cards</h3>
                      <p>Choose a debt card to edit it. This page only manages the debt library.</p>
                    </div>
                    <div className="record-count-pill">{formatSectionCount(form.debts.length, 'card', 'cards')}</div>
                  </div>

                  <div className="record-list">
                    {form.debts.map((debt) => (
                      <button
                        className={`record-list-item${selectedDebt?.id === debt.id ? ' is-active' : ''}`}
                        key={debt.id}
                        onClick={() => {
                          setSelectedDebtId(debt.id);
                        }}
                        type="button"
                      >
                        <strong>{debt.name}</strong>
                        <span>{getDebtKindLabel(debt.kind)} · Due day {debt.dueDay}</span>
                        <small>
                          {debt.sourceSplitBillId
                            ? `Built from ${
                                form.splitBills.find((bill) => bill.id === debt.sourceSplitBillId)?.name ?? 'split item'
                              }`
                            : money.format(debt.balance)}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="record-editor-panel modal-panel">
                  {selectedDebt ? (
                    <>
                      <div className="record-panel-header">
                        <div>
                          <p className="eyebrow">Selected debt model</p>
                          <h3>{selectedDebt.name}</h3>
                          <p>
                            Seed this debt from a split item if you want, then add the balance, APR, interest
                            rate, and any overrides needed for payoff tracking.
                          </p>
                        </div>
                      </div>

                      <article
                        className="debt-editor-card"
                        data-editor-target={`debt-${selectedDebt.id}`}
                      >
                        <div className="field-grid debt-topline">
                          <label className="field">
                            <span>Build from split item</span>
                            <select
                              value={selectedDebt.sourceSplitBillId ?? ''}
                              onChange={(event) => {
                                const splitBillId = event.target.value;
                                const splitBill = form.splitBills.find((bill) => bill.id === splitBillId);

                                if (!splitBill) {
                                  onChange(updateDebt(form, selectedDebt.id, { sourceSplitBillId: null }));
                                  return;
                                }

                                onChange(
                                  updateDebt(
                                    form,
                                    selectedDebt.id,
                                    buildDebtFromSplitBill(selectedDebt, splitBill, form.income.windowCutoffDay),
                                  ),
                                );
                              }}
                            >
                              <option value="">No source split item</option>
                              {form.splitBills.map((bill) => (
                                <option key={bill.id} value={bill.id}>
                                  {bill.name} · {money.format(getSplitBillMinimum(bill))}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span>Name</span>
                            <input
                              value={selectedDebt.name}
                              onChange={(event) => {
                                onChange(updateDebt(form, selectedDebt.id, { name: event.target.value }));
                              }}
                            />
                          </label>
                        </div>

                        <div className="field-grid field-grid-triple">
                          <label className="field">
                            <span>Type</span>
                            <select
                              value={selectedDebt.kind}
                              onChange={(event) => {
                                onChange(
                                  updateDebt(form, selectedDebt.id, {
                                    kind: event.target.value as DebtKind,
                                  }),
                                );
                              }}
                            >
                              {debtTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span>Due day</span>
                            <NumberInput
                              inputMode="numeric"
                              value={selectedDebt.dueDay}
                              onValueChange={(nextValue) => {
                                const dueDay = Math.max(1, Math.min(31, nextValue));
                                onChange(
                                  updateDebt(form, selectedDebt.id, {
                                    dueDay,
                                    dueWindow: getDueWindowForDay(dueDay, form.income.windowCutoffDay),
                                  }),
                                );
                              }}
                            />
                          </label>
                          <div className="metric-card">
                            <span>Move suggestion</span>
                            <strong>
                              {canSuggestMovingDebtDueDate(selectedDebt)
                                ? 'Eligible for date-move suggestions'
                                : 'Fixed or non-movable'}
                            </strong>
                          </div>
                        </div>

                        <div className="field-grid split-grid">
                          <label className="field">
                            <span>Balance</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedDebt.balance}
                              onValueChange={(nextValue) => {
                                onChange(updateDebt(form, selectedDebt.id, { balance: nextValue }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>APR</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedDebt.apr}
                              onValueChange={(nextValue) => {
                                onChange(updateDebt(form, selectedDebt.id, { apr: nextValue }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>Interest rate</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedDebt.interestRate}
                              onValueChange={(nextValue) => {
                                onChange(updateDebt(form, selectedDebt.id, { interestRate: nextValue }));
                              }}
                            />
                          </label>
                          <label className="field">
                            <span>Minimum payment</span>
                            <NumberInput
                              inputMode="decimal"
                              value={selectedDebt.minimumPayment}
                              onValueChange={(nextValue) => {
                                onChange(updateDebt(form, selectedDebt.id, { minimumPayment: nextValue }));
                              }}
                            />
                          </label>
                        </div>

                        <button
                          className="text-button"
                          disabled={form.debts.length === 1}
                          onClick={() => {
                            const remaining = form.debts.filter((item) => item.id !== selectedDebt.id);
                            onChange({
                              ...form,
                              debts: remaining,
                            });
                            setSelectedDebtId(remaining[0]?.id ?? null);
                          }}
                          type="button"
                        >
                          Remove this debt model
                        </button>
                      </article>
                    </>
                  ) : (
                    <div className="record-empty-state">
                      <p className="eyebrow">No selection</p>
                      <h3>Create your first debt model</h3>
                      <p>Add a debt here and it will appear as its own movable card on the planning canvas.</p>
                      <button
                        className="primary-button"
                        onClick={() => {
                          const id = onAddDebtModel();
                          setSelectedDebtId(id);
                        }}
                        type="button"
                      >
                        New debt model
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-footer">
          <p>
            Changes save automatically, so you can update each section and return to the canvas whenever you are ready.
          </p>
          <div className="modal-footer-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Close
            </button>
            <button className="primary-button" onClick={onClose} type="button">
              Save and return to canvas
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

interface CloudSyncModalProps {
  email: string;
  errorMessage: string | null;
  infoMessage: string | null;
  isBootstrapping: boolean;
  isConfigured: boolean;
  isLoading: boolean;
  isOpen: boolean;
  lastSyncedAt: string | null;
  mode: AuthMode;
  password: string;
  user: User | null;
  onClose: () => void;
  onEmailChange: (value: string) => void;
  onLoadCloud: () => void;
  onModeChange: (mode: AuthMode) => void;
  onPasswordChange: (value: string) => void;
  onSignOut: () => void;
  onSubmit: () => void;
  onSyncNow: () => void;
}

function CloudSyncModal({
  email,
  errorMessage,
  infoMessage,
  isBootstrapping,
  isConfigured,
  isLoading,
  isOpen,
  lastSyncedAt,
  mode,
  password,
  user,
  onClose,
  onEmailChange,
  onLoadCloud,
  onModeChange,
  onPasswordChange,
  onSignOut,
  onSubmit,
  onSyncNow,
}: CloudSyncModalProps) {
  if (!isOpen) {
    return null;
  }

  const isSignedIn = Boolean(user);
  const syncStatusLabel = isLoading ? 'Syncing' : lastSyncedAt ? 'Synced' : isBootstrapping ? 'Loading cloud' : 'Auto-sync on';

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        onClose();
      }}
    >
      <section
        className="editor-modal auth-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="modal-header">
          <div className="modal-heading">
            <p className="eyebrow">Cloud sync</p>
            <h2>Supabase account and workspace sync</h2>
            <p className="modal-copy">
              Sign in to back up this canvas to Supabase, auto-sync changes, and load it again on another machine.
            </p>
          </div>
          <div className="modal-actions">
            <button className="icon-button" onClick={onClose} type="button">
              ×
            </button>
          </div>
        </div>

        {!isConfigured ? (
          <div className="auth-stack">
            <div className="signal-callout">
              <p className="eyebrow">Not configured</p>
              <p className="signal-copy">
                Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.local`, then restart `npm run dev`.
              </p>
            </div>
          </div>
        ) : isSignedIn ? (
          <div className="auth-stack">
              <div className="metric-grid compact">
                <div className="metric-card">
                  <span>Account</span>
                  <strong>{user?.email ?? 'Signed in'}</strong>
                </div>
                <div className="metric-card">
                  <span>Status</span>
                  <strong>{syncStatusLabel}</strong>
                  <small>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : 'No cloud save yet'}</small>
                </div>
              </div>

            <div className="button-stack auth-actions">
              <button className="primary-button" disabled={isLoading} onClick={onSyncNow} type="button">
                {isLoading ? 'Syncing...' : 'Sync current workspace'}
              </button>
              <button className="ghost-button" disabled={isLoading} onClick={onLoadCloud} type="button">
                {isLoading ? 'Loading...' : 'Load workspace from cloud'}
              </button>
              <button className="ghost-button" disabled={isLoading} onClick={onSignOut} type="button">
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-stack">
            <div className="auth-mode-toggle">
              <button
                className={mode === 'sign-in' ? 'primary-button' : 'ghost-button'}
                onClick={() => {
                  onModeChange('sign-in');
                }}
                type="button"
              >
                Sign in
              </button>
              <button
                className={mode === 'sign-up' ? 'primary-button' : 'ghost-button'}
                onClick={() => {
                  onModeChange('sign-up');
                }}
                type="button"
              >
                Create account
              </button>
            </div>

            <div className="field-grid field-grid-tight">
              <label className="field">
                <span>Email</span>
                <input
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    onEmailChange(event.target.value);
                  }}
                  placeholder="you@example.com"
                  type="email"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => {
                    onPasswordChange(event.target.value);
                  }}
                  type="password"
                />
              </label>
            </div>

            <button className="primary-button" disabled={isLoading} onClick={onSubmit} type="button">
              {isLoading ? 'Working...' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          </div>
        )}

        {infoMessage ? (
          <div className="signal-callout auth-message">
            <p className="eyebrow">Status</p>
            <p className="signal-copy">{infoMessage}</p>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="signal-callout auth-message auth-message-error">
            <p className="eyebrow">Error</p>
            <p className="signal-copy">{errorMessage}</p>
          </div>
        ) : null}

        <div className="modal-footer">
          <p>Local saving stays on automatically. Cloud sync now also auto-saves changes and listens for cloud updates.</p>
          <div className="modal-footer-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

interface CardFrameProps {
  title: string;
  subtitle: string;
  layout: Debt['layout'];
  collapsed: boolean;
  onActivate: () => void;
  onStartInteraction: (mode: InteractionMode, event: React.PointerEvent<HTMLElement>) => void;
  onToggleCollapse: () => void;
  children: React.ReactNode;
  meta?: React.ReactNode;
}

function CardFrame({
  title,
  subtitle,
  layout,
  collapsed,
  onActivate,
  onStartInteraction,
  onToggleCollapse,
  children,
  meta,
}: CardFrameProps) {
  return (
    <article
      className={`debt-card${collapsed ? ' is-collapsed' : ''}`}
      onPointerDown={onActivate}
      style={{
        height: getRenderedHeight(layout, collapsed),
        transform: `translate(${layout.x}px, ${layout.y}px)`,
        width: layout.width,
        zIndex: layout.zIndex,
      }}
    >
      <div className="debt-card-header" onPointerDown={(event) => onStartInteraction('drag', event)}>
        <div className="debt-card-heading">
          <p className="debt-card-name">{title}</p>
          <div className="debt-card-subtitle">
            <span>{subtitle}</span>
          </div>
        </div>

        <div className="card-header-actions">
          {meta ? <div className="debt-card-metrics">{meta}</div> : null}
          <button
            className="icon-button collapse-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleCollapse();
            }}
            type="button"
          >
            {collapsed ? '+' : '−'}
          </button>
        </div>
      </div>

      {!collapsed ? <div className="debt-card-body">{children}</div> : null}

      {!collapsed ? (
        <>
          <button
            aria-label={`Resize ${title} width`}
            className="resize-handle resize-handle-x"
            onPointerDown={(event) => onStartInteraction('resize-x', event)}
            type="button"
          />
          <button
            aria-label={`Resize ${title} height`}
            className="resize-handle resize-handle-y"
            onPointerDown={(event) => onStartInteraction('resize-y', event)}
            type="button"
          />
          <button
            aria-label={`Resize ${title}`}
            className="resize-handle resize-handle-xy"
            onPointerDown={(event) => onStartInteraction('resize-xy', event)}
            type="button"
          />
        </>
      ) : null}
    </article>
  );
}

interface CanvasPanelCardProps {
  panel: CanvasPanelState;
  title: string;
  subtitle: string;
  meta?: React.ReactNode;
  onActivate: () => void;
  onStartInteraction: (mode: InteractionMode, event: React.PointerEvent<HTMLElement>) => void;
  onToggleCollapse: () => void;
  children: React.ReactNode;
}

function CanvasPanelCard({
  panel,
  title,
  subtitle,
  meta,
  onActivate,
  onStartInteraction,
  onToggleCollapse,
  children,
}: CanvasPanelCardProps) {
  return (
    <CardFrame
      collapsed={panel.collapsed}
      layout={panel.layout}
      meta={meta}
      onActivate={onActivate}
      onStartInteraction={onStartInteraction}
      onToggleCollapse={onToggleCollapse}
      subtitle={subtitle}
      title={title}
    >
      {children}
    </CardFrame>
  );
}

interface DebtCardProps {
  debt: Debt;
  rollup: DebtRollup;
  onActivate: () => void;
  onStartInteraction: (mode: InteractionMode, event: React.PointerEvent<HTMLElement>) => void;
  onToggleCollapse: () => void;
}

function DebtCard({ debt, rollup, onActivate, onStartInteraction, onToggleCollapse }: DebtCardProps) {
  return (
    <CardFrame
      collapsed={debt.collapsed}
      layout={debt.layout}
      meta={
        <>
          <div>
            <span>Start</span>
            <strong>{money.format(rollup.startingBalance)}</strong>
          </div>
          <div>
            <span>Payoff</span>
            <strong>{rollup.payoffMonth ?? 'In progress'}</strong>
          </div>
        </>
      }
      onActivate={onActivate}
      onStartInteraction={onStartInteraction}
      onToggleCollapse={onToggleCollapse}
      subtitle={`${getDebtKindLabel(debt.kind)} · ${formatDebtRateLabel(debt)}${debt.apr > 0 && debt.interestRate > 0 ? ` · ${debt.interestRate}% rate` : ''} · due day ${debt.dueDay} · ${
        rollup.dueWindow === 'first' ? 'paycheck 1 window' : 'paycheck 2 window'
      }`}
      title={debt.name}
    >
      <table className="debt-ledger-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Owed</th>
            <th>Paid</th>
            <th>Left</th>
            <th>% Left</th>
          </tr>
        </thead>
        <tbody>
          {rollup.timeline.map((entry) => (
            <tr key={`${rollup.debtId}-${entry.month}`}>
              <td>{entry.month}</td>
              <td>{money.format(entry.owed)}</td>
              <td>{money.format(entry.paid)}</td>
              <td>{money.format(entry.left)}</td>
              <td>{percent.format(Math.max(entry.percentLeft, 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardFrame>
  );
}

interface SplitLedgerCardProps {
  bills: SplitBill[];
  panel: CanvasPanelState;
  onActivate: () => void;
  onStartInteraction: (mode: InteractionMode, event: React.PointerEvent<HTMLElement>) => void;
  onToggleCollapse: () => void;
}

function SplitLedgerCard({
  bills,
  panel,
  onActivate,
  onStartInteraction,
  onToggleCollapse,
}: SplitLedgerCardProps) {
  const firstWindowBills = bills.filter((bill) => bill.firstWindowAmount > 0);
  const secondWindowBills = bills.filter((bill) => bill.secondWindowAmount > 0);
  const firstWindowTotal = firstWindowBills.reduce((sum, bill) => sum + bill.firstWindowAmount, 0);
  const secondWindowTotal = secondWindowBills.reduce((sum, bill) => sum + bill.secondWindowAmount, 0);

  return (
    <CanvasPanelCard
      meta={
        <>
          <div>
            <span>Paycheck 1</span>
            <strong>{money.format(firstWindowTotal)}</strong>
          </div>
          <div>
            <span>Paycheck 2</span>
            <strong>{money.format(secondWindowTotal)}</strong>
          </div>
        </>
      }
      onActivate={onActivate}
      onStartInteraction={onStartInteraction}
      onToggleCollapse={onToggleCollapse}
      panel={panel}
      subtitle="Organized by pay window instead of by bill"
      title="Split model"
    >
      <div className="split-window-grid">
        <section className="split-window-column">
          <div className="split-window-header">
            <span>Paycheck 1</span>
            <strong>{money.format(firstWindowTotal)}</strong>
          </div>
          <div className="split-window-list">
            {firstWindowBills.map((bill) => (
              <article className="split-window-item" key={`${bill.id}-first`}>
                <div>
                  <p>{bill.name}</p>
                  <small>
                    {formatSplitBillDueDay(bill.dueDay)} · Total {money.format(bill.totalAmount)}
                  </small>
                </div>
                <strong>{money.format(bill.firstWindowAmount)}</strong>
              </article>
            ))}
            {firstWindowBills.length === 0 ? (
              <div className="split-window-empty">No first-paycheck split items.</div>
            ) : null}
          </div>
        </section>

        <section className="split-window-column">
          <div className="split-window-header">
            <span>Paycheck 2</span>
            <strong>{money.format(secondWindowTotal)}</strong>
          </div>
          <div className="split-window-list">
            {secondWindowBills.map((bill) => (
              <article className="split-window-item" key={`${bill.id}-second`}>
                <div>
                  <p>{bill.name}</p>
                  <small>
                    {formatSplitBillDueDay(bill.dueDay)} · Total {money.format(bill.totalAmount)}
                  </small>
                </div>
                <strong>{money.format(bill.secondWindowAmount)}</strong>
              </article>
            ))}
            {secondWindowBills.length === 0 ? (
              <div className="split-window-empty">No second-paycheck split items.</div>
            ) : null}
          </div>
        </section>
      </div>
    </CanvasPanelCard>
  );
}

interface WindowCardProps {
  panel: CanvasPanelState;
  allocation: WindowAllocation;
  onActivate: () => void;
  onStartInteraction: (mode: InteractionMode, event: React.PointerEvent<HTMLElement>) => void;
  onToggleCollapse: () => void;
}

function WindowCard({
  panel,
  allocation,
  onActivate,
  onStartInteraction,
  onToggleCollapse,
}: WindowCardProps) {
  return (
    <CanvasPanelCard
      meta={
        <>
          <div>
            <span>Income</span>
            <strong>{money.format(allocation.income)}</strong>
          </div>
          <div>
            <span>Left</span>
            <strong>{money.format(allocation.left)}</strong>
          </div>
        </>
      }
      onActivate={onActivate}
      onStartInteraction={onStartInteraction}
      onToggleCollapse={onToggleCollapse}
      panel={panel}
      subtitle="What gets spent now, what gets reserved, and what can go to debt"
      title={`${allocation.title} window`}
    >
      <div className="window-allocation-stack">
        <div className="metric-grid compact">
          <div className="metric-card">
            <span>Spend reserve</span>
            <strong>{money.format(allocation.spend)}</strong>
          </div>
          <div className="metric-card">
            <span>Bill reserves</span>
            <strong>{money.format(allocation.reserve)}</strong>
          </div>
          <div className="metric-card">
            <span>Debt minimums due</span>
            <strong>{money.format(allocation.minimumDebtPayments)}</strong>
          </div>
          <div className="metric-card">
            <span>Extra you could put toward debt</span>
            <strong>{money.format(allocation.extraDebtPayments)}</strong>
          </div>
          <div className="metric-card">
            <span>Left after routing</span>
            <strong>{money.format(allocation.left)}</strong>
          </div>
        </div>

        {allocation.extraDebtPayments > 0 ? (
          <p className="panel-copy">
            This is extra money left in this window after spend reserves, bill reserves, and minimum debt payments.
            You could choose to put it toward one of your debts.
          </p>
        ) : null}

        {allocation.items.map((item) => (
          <div className={`allocation-row allocation-row-${item.type}`} key={item.id}>
            <span>{item.label}</span>
            <strong>{item.type === 'income' ? `+${money.format(item.amount)}` : money.format(item.amount)}</strong>
          </div>
        ))}

        <div className="allocation-summary">
          <div className="allocation-row">
            <span>Total routed from this paycheck</span>
            <strong>{money.format(allocation.committed)}</strong>
          </div>
          <div className="allocation-row">
            <span>Available after routing</span>
            <strong>{money.format(allocation.left)}</strong>
          </div>
        </div>
      </div>
    </CanvasPanelCard>
  );
}

function App() {
  const storedPlan = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
  const [form, setForm] = useState<PlannerForm>(() => {
    if (!storedPlan) {
      return clonePlan(samplePlan);
    }

    try {
      return normalizePlan(JSON.parse(storedPlan));
    } catch {
      return clonePlan(samplePlan);
    }
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const storedTheme = window.localStorage.getItem(themeKey) ?? window.localStorage.getItem(legacyThemeKey);
    return storedTheme === 'light' ? 'light' : 'dark';
  });
  const [isEditorOpen, setEditorOpen] = useState(() => !storedPlan);
  const [isCloudModalOpen, setCloudModalOpen] = useState(false);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [editorFocusTarget, setEditorFocusTarget] = useState<{ id: string; type: 'split' | 'debt' } | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in');
  const [authEmail, setAuthEmail] = useState(
    () => window.localStorage.getItem(authEmailKey) ?? window.localStorage.getItem(legacyAuthEmailKey) ?? '',
  );
  const [authPassword, setAuthPassword] = useState('');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [cloudInfoMessage, setCloudInfoMessage] = useState<string | null>(null);
  const [cloudErrorMessage, setCloudErrorMessage] = useState<string | null>(null);
  const [isCloudBusy, setCloudBusy] = useState(false);
  const [isCloudBootstrapping, setCloudBootstrapping] = useState(false);
  const [lastCloudSyncedAt, setLastCloudSyncedAt] = useState<string | null>(null);
  const [updaterState, setUpdaterState] = useState<UpdaterState>({
    canInstall: false,
    configured: false,
    message: 'Waiting for updater status.',
    status: 'up-to-date',
    updatedAt: 0,
  });
  const cloudBootstrapUserIdRef = useRef<string | null>(null);
  const skipNextCloudPushRef = useRef(false);
  const lastCloudSyncAtRef = useRef<string | null>(null);
  const latestFormRef = useRef(form);
  const latestThemeRef = useRef(theme);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(form));
    if (window.localStorage.getItem(legacyStorageKey)) {
      window.localStorage.removeItem(legacyStorageKey);
    }
    latestFormRef.current = form;
  }, [form]);

  useEffect(() => {
    window.localStorage.setItem(themeKey, theme);
    if (window.localStorage.getItem(legacyThemeKey)) {
      window.localStorage.removeItem(legacyThemeKey);
    }
    document.documentElement.dataset.theme = theme;
    latestThemeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(authEmailKey, authEmail.trim());
    if (window.localStorage.getItem(legacyAuthEmailKey)) {
      window.localStorage.removeItem(legacyAuthEmailKey);
    }
  }, [authEmail]);

  useEffect(() => {
    let receivedLiveStatus = false;
    let latestSeenState = 0;

    const applyUpdaterState = (payload: UpdaterState | null | undefined) => {
      if (!payload) {
        return;
      }

      if ((payload.updatedAt ?? 0) < latestSeenState) {
        return;
      }

      latestSeenState = payload.updatedAt ?? latestSeenState;
      setUpdaterState(payload);
    };

    const unsubscribe = window.desktopMeta?.updater?.onStatus((payload) => {
      receivedLiveStatus = true;
      applyUpdaterState(payload);
    });

    window.desktopMeta?.updater
      ?.getState?.()
      .then((payload) => {
        if (!receivedLiveStatus) {
          applyUpdaterState(payload);
        }
      })
      .catch(() => {});

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (updaterState.status !== 'checking' && updaterState.status !== 'downloading') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      window.desktopMeta?.updater
        ?.getState?.()
        .then((payload) => {
          if (!payload) {
            return;
          }

          setUpdaterState((current) => ((payload.updatedAt ?? 0) > (current.updatedAt ?? 0) ? payload : current));
        })
        .catch(() => {});
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, [updaterState.status]);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setCloudErrorMessage(error.message);
        return;
      }

      setAuthUser(data.session?.user ?? null);
      if (data.session?.user.email) {
        setAuthEmail(data.session.user.email);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      if (session?.user.email) {
        setAuthEmail(session.user.email);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !authUser) {
      cloudBootstrapUserIdRef.current = null;
      setCloudBootstrapping(false);
      return;
    }

    if (cloudBootstrapUserIdRef.current === authUser.id) {
      return;
    }

    cloudBootstrapUserIdRef.current = authUser.id;
    setCloudBootstrapping(true);
    setCloudErrorMessage(null);

    let isCancelled = false;

    loadWorkspaceFromCloud()
      .then(async (record) => {
        if (isCancelled) {
          return;
        }

        if (record) {
          applyCloudWorkspace(
            record.planner_state,
            record.theme === 'light' ? 'light' : 'dark',
            record.last_synced_at,
            `Loaded cloud workspace from ${new Date(record.last_synced_at).toLocaleString()}.`,
          );
          return;
        }

        const syncedRecord = await saveWorkspaceToCloud(latestFormRef.current, latestThemeRef.current);
        if (isCancelled) {
          return;
        }

        lastCloudSyncAtRef.current = syncedRecord.last_synced_at;
        setLastCloudSyncedAt(syncedRecord.last_synced_at);
        setCloudInfoMessage('No cloud workspace existed yet, so your current local workspace was uploaded.');
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setCloudErrorMessage(error instanceof Error ? error.message : 'Unable to initialize cloud workspace.');
      })
      .finally(() => {
        if (!isCancelled) {
          setCloudBootstrapping(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [authUser]);

  useEffect(() => {
    if (!supabase || !authUser) {
      return undefined;
    }

    const channel = supabase
      .channel(`quarterly-workspace-${authUser.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'finance_app_workspaces',
          filter: `user_id=eq.${authUser.id}`,
        },
        (payload) => {
          const nextRow = payload.new as
            | {
                planner_state?: PlannerForm;
                theme?: Theme;
                last_synced_at?: string;
              }
            | undefined;

          if (!nextRow?.planner_state || !nextRow.last_synced_at) {
            return;
          }

          if (lastCloudSyncAtRef.current === nextRow.last_synced_at) {
            return;
          }

          applyCloudWorkspace(
            nextRow.planner_state,
            nextRow.theme === 'light' ? 'light' : 'dark',
            nextRow.last_synced_at,
            `Workspace updated from another signed-in device at ${new Date(nextRow.last_synced_at).toLocaleString()}.`,
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authUser]);

  useEffect(() => {
    if (!supabase || !authUser || isCloudBootstrapping) {
      return undefined;
    }

    if (skipNextCloudPushRef.current) {
      skipNextCloudPushRef.current = false;
      return undefined;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const record = await saveWorkspaceToCloud(form, theme);
        lastCloudSyncAtRef.current = record.last_synced_at;
        setLastCloudSyncedAt(record.last_synced_at);
        setCloudInfoMessage(`Auto-synced at ${new Date(record.last_synced_at).toLocaleTimeString()}.`);
      } catch (error) {
        setCloudErrorMessage(error instanceof Error ? error.message : 'Automatic cloud sync failed.');
      }
    }, 900);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [authUser, form, isCloudBootstrapping, theme]);

  useEffect(() => {
    if (!interaction) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = snapToGrid(event.clientX - interaction.startX);
      const deltaY = snapToGrid(event.clientY - interaction.startY);

      setForm((current) => {
        const targetLayout = getTargetLayout(current, interaction.targetType, interaction.targetId);
        if (!targetLayout) {
          return current;
        }

        const currentLayout = interaction.startLayout;
        let nextLayout = { ...targetLayout };

        if (interaction.mode === 'drag') {
          nextLayout = {
            ...targetLayout,
            x: clamp(currentLayout.x + deltaX, 24, 8000),
            y: clamp(currentLayout.y + deltaY, 24, 8000),
          };
        }

        if (interaction.mode === 'resize-x' || interaction.mode === 'resize-xy') {
          nextLayout.width = clamp(snapToGrid(currentLayout.width + deltaX), 300, 980);
        }

        if (interaction.mode === 'resize-y' || interaction.mode === 'resize-xy') {
          nextLayout.height = clamp(snapToGrid(currentLayout.height + deltaY), 220, 880);
        }

        if (
          nextLayout.x === targetLayout.x &&
          nextLayout.y === targetLayout.y &&
          nextLayout.width === targetLayout.width &&
          nextLayout.height === targetLayout.height
        ) {
          return current;
        }

        const nextForm = setTargetLayout(current, interaction.targetType, interaction.targetId, {
          ...targetLayout,
          ...nextLayout,
        });

        const collisionMotion =
          interaction.mode === 'drag'
            ? { x: deltaX, y: deltaY }
            : interaction.mode === 'resize-x'
            ? { x: nextLayout.width - targetLayout.width, y: 0 }
            : interaction.mode === 'resize-y'
            ? { x: 0, y: nextLayout.height - targetLayout.height }
            : {
                x: nextLayout.width - targetLayout.width,
                y: nextLayout.height - targetLayout.height,
              };

        return resolveCollisions(nextForm, interaction.targetType, interaction.targetId, collisionMotion);
      });
    };

    const handlePointerUp = () => {
      setInteraction(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [interaction]);

  useEffect(() => {
    if (!isEditorOpen || !editorFocusTarget) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-editor-target="${editorFocusTarget.type}-${editorFocusTarget.id}"]`,
      );
      if (!element) {
        return;
      }

      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const field = element.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      field?.focus();
      setEditorFocusTarget(null);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [editorFocusTarget, isEditorOpen]);

  const plan = buildPlan(form);
  const canvasSize = getCanvasSize(form);

  const activateTarget = (targetType: InteractionTarget, targetId: string) => {
    setForm((current) => bringToFront(current, targetType, targetId));
  };

  const addSplitItem = () => {
    const newBill = createSplitBill(form.splitBills.length);
    setForm((current) => ({
      ...current,
      splitBills: [...current.splitBills, newBill],
    }));
    setEditorFocusTarget({ id: newBill.id, type: 'split' });
    return newBill.id;
  };

  const addDebtModel = () => {
    const newDebt = createDebt(form.debts.length);
    newDebt.layout = {
      ...newDebt.layout,
      x: 64 + (form.debts.length % 2) * 496,
      y: 340,
      zIndex: getHighestZ(form) + 1,
    };

    setForm((current) =>
      resolveCollisions(
        {
          ...current,
          debts: [...current.debts, newDebt],
        },
        'debt',
        newDebt.id,
        { x: 0, y: 1 },
      ),
    );
    setEditorFocusTarget({ id: newDebt.id, type: 'debt' });
    return newDebt.id;
  };

  const runCloudAction = async (action: () => Promise<void>) => {
    setCloudBusy(true);
    setCloudErrorMessage(null);

    try {
      await action();
    } catch (error) {
      setCloudErrorMessage(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setCloudBusy(false);
    }
  };

  const applyCloudWorkspace = (
    plannerState: PlannerForm,
    nextTheme: Theme,
    syncedAt: string,
    message: string,
    closeModal = false,
  ) => {
    skipNextCloudPushRef.current = true;
    lastCloudSyncAtRef.current = syncedAt;
    setLastCloudSyncedAt(syncedAt);
    setForm(normalizePlan(plannerState));
    setTheme(nextTheme);
    setCloudInfoMessage(message);
    if (closeModal) {
      setCloudModalOpen(false);
    }
  };

  const handleCloudAuthSubmit = () => {
    if (!supabase) {
      setCloudErrorMessage('Supabase is not configured. Add your `.env.local` values and restart the app.');
      return;
    }

    runCloudAction(async () => {
      if (!authEmail.trim() || !authPassword.trim()) {
        throw new Error('Enter both email and password.');
      }

      const nextEmail = authEmail.trim();

      if (authMode === 'sign-in') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: nextEmail,
          password: authPassword,
        });

        if (error) {
          throw error;
        }

        setAuthUser(data.user ?? null);
        setAuthEmail(data.user?.email ?? nextEmail);
        setCloudInfoMessage(`Signed in as ${data.user?.email ?? nextEmail}.`);
        setAuthPassword('');
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: nextEmail,
        password: authPassword,
      });

      if (error) {
        throw error;
      }

      setAuthUser(data.user ?? null);
      setAuthEmail(data.user?.email ?? nextEmail);
      setAuthPassword('');
      setCloudInfoMessage(
        data.session
          ? `Account created and signed in as ${data.user?.email ?? nextEmail}.`
          : 'Account created. Check your email if Supabase requires confirmation before sign-in.',
      );
    });
  };

  const handleCloudSignOut = () => {
    if (!supabase) {
      return;
    }

    runCloudAction(async () => {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        throw error;
      }

      cloudBootstrapUserIdRef.current = null;
      lastCloudSyncAtRef.current = null;
      setLastCloudSyncedAt(null);
      skipNextCloudPushRef.current = false;
      setAuthUser(null);
      setCloudInfoMessage('Signed out.');
    });
  };

  const handleSyncNow = () => {
    runCloudAction(async () => {
      const record = await saveWorkspaceToCloud(form, theme);
      lastCloudSyncAtRef.current = record.last_synced_at;
      setLastCloudSyncedAt(record.last_synced_at);
      setCloudInfoMessage(`Workspace synced to cloud at ${new Date(record.last_synced_at).toLocaleString()}.`);
    });
  };

  const handleLoadCloud = () => {
    runCloudAction(async () => {
      const record = await loadWorkspaceFromCloud();
      if (!record) {
        setCloudInfoMessage('No cloud workspace was found for this account yet.');
        return;
      }

      applyCloudWorkspace(
        record.planner_state,
        record.theme === 'light' ? 'light' : 'dark',
        record.last_synced_at,
        `Loaded cloud workspace saved at ${new Date(record.last_synced_at).toLocaleString()}.`,
        true,
      );
    });
  };

  const handleCheckForUpdates = async () => {
    setUpdaterState((current) => ({
      ...current,
      message: 'Checking for updates...',
      status: 'checking',
      updatedAt: Date.now(),
    }));

    try {
      const result = await window.desktopMeta?.updater?.check();
      if (!result) {
        setUpdaterState((current) => ({
          ...current,
          message: 'Updater bridge is not available in this build.',
          status: 'error',
          updatedAt: Date.now(),
        }));
        return;
      }

      setUpdaterState((current) => ((result.updatedAt ?? 0) >= (current.updatedAt ?? 0) ? result : current));
    } catch (error) {
      setUpdaterState((current) => ({
        ...current,
        message: error instanceof Error ? error.message : 'Unable to check for updates.',
        status: 'error',
        updatedAt: Date.now(),
      }));
    }
  };

  const handleInstallUpdate = async () => {
    await window.desktopMeta?.updater?.install();
  };

  const startInteraction =
    (targetType: InteractionTarget, targetId: string, layout: Debt['layout']) =>
    (mode: InteractionMode, event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setForm((current) => bringToFront(current, targetType, targetId));
      setInteraction({
        targetId,
        targetType,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        startLayout: { ...layout },
      });
    };

  const cloudStatusTone = cloudErrorMessage
    ? 'error'
    : !isSupabaseConfigured
    ? 'muted'
    : !authUser
    ? 'muted'
    : isCloudBusy
    ? 'syncing'
    : lastCloudSyncedAt
    ? 'ready'
    : isCloudBootstrapping
    ? 'syncing'
    : 'muted';
  const cloudStatusLabel = cloudErrorMessage
    ? 'Cloud error'
    : !isSupabaseConfigured
    ? 'Cloud off'
    : !authUser
    ? 'Local only'
    : isCloudBusy
    ? 'Syncing'
    : lastCloudSyncedAt
    ? 'Synced'
    : isCloudBootstrapping
    ? 'Loading cloud'
    : 'Connected';
  const cloudStatusDetail = authUser
    ? authUser.email ?? 'Signed in'
    : !isSupabaseConfigured
    ? 'Supabase not configured'
    : 'Sign in to sync';
  const lastSyncLabel = lastCloudSyncedAt ? new Date(lastCloudSyncedAt).toLocaleTimeString() : 'Not yet';
  const updaterTone =
    updaterState.status === 'error' || updaterState.status === 'not-configured'
      ? 'error'
      : updaterState.status === 'checking' || updaterState.status === 'available' || updaterState.status === 'downloading'
      ? 'syncing'
      : updaterState.status === 'downloaded' || updaterState.status === 'up-to-date'
      ? 'ready'
      : 'muted';
  const updaterLabel =
    updaterState.status === 'downloaded'
      ? 'Ready to restart'
      : updaterState.status === 'downloading'
      ? updaterState.percent
        ? `Downloading ${Math.round(updaterState.percent)}%`
        : 'Downloading'
      : updaterState.status === 'available'
      ? 'Update found'
      : updaterState.status === 'up-to-date'
      ? 'Up to date'
      : updaterState.status === 'not-configured'
      ? 'Updater not configured'
      : updaterState.status === 'error'
      ? 'Update error'
      : updaterState.status === 'dev-mode'
      ? 'Installed builds only'
      : 'Checking';
  const updaterActionLabel = updaterState.status === 'checking' ? 'Checking…' : 'Check for updates';
  const installedVersionLabel = window.desktopMeta?.versions.app ? `v${window.desktopMeta.versions.app}` : 'Current build';
  const latestVersionLabel = updaterState.version ? `Latest release v${updaterState.version}` : 'Latest release not checked yet';

  return (
    <>
      <main className="app-shell">
        <div className="window-drag-region" aria-hidden="true">
          <div className="window-drag-label">
            <QuarterlyWordmark showBadge />
            <span className="window-drag-workspace">{form.planName}</span>
          </div>
        </div>
        <section className="canvas-viewport">
          <div className="canvas-board" style={{ height: canvasSize.height, width: canvasSize.width }}>
            <div className="canvas-note">
              <span>{form.debts.length} debt cards</span>
              <span>{form.splitBills.length} split items</span>
            </div>

            <CanvasPanelCard
              meta={
                <div>
                  <span>Plan</span>
                  <strong>{form.planName}</strong>
                </div>
              }
              onActivate={() => {
                activateTarget('panel', 'overview');
              }}
              onStartInteraction={startInteraction('panel', 'overview', form.panels.overview.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'overview'));
              }}
              panel={form.panels.overview}
              subtitle="Two paycheck windows, split reserves, and debt timing in one workspace"
              title={form.planName}
            >
              <div className="panel-stack">
                <p className="panel-copy">
                  Route each paycheck on purpose: set aside personal spend, reserve money for later bills,
                  pay what is due now, and use the remaining room to speed up debt payoff.
                </p>
              </div>
            </CanvasPanelCard>

            <CanvasPanelCard
              meta={
                <div>
                  <span>Total income</span>
                  <strong>{money.format(plan.totalIncome)}</strong>
                </div>
              }
              onActivate={() => {
                activateTarget('panel', 'summary');
              }}
              onStartInteraction={startInteraction('panel', 'summary', form.panels.summary.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'summary'));
              }}
              panel={form.panels.summary}
              subtitle="What the month looks like before and after paycheck routing"
              title="Snapshot"
            >
              <div className="metric-grid">
                <div className="metric-card">
                  <span>Total debt</span>
                  <strong>{money.format(plan.totalBalance)}</strong>
                </div>
                <div className="metric-card">
                  <span>Total reserved for bills</span>
                  <strong>{money.format(plan.totalReserved)}</strong>
                </div>
                <div className="metric-card">
                  <span>Debt minimums due</span>
                  <strong>{money.format(plan.totalMinimums)}</strong>
                </div>
                <div className="metric-card">
                  <span>Extra payoff room</span>
                  <strong>{money.format(plan.totalExtraDebt)}</strong>
                </div>
                <div className="metric-card">
                  <span>Paycheck 1 left</span>
                  <strong>{money.format(plan.firstWindow.left)}</strong>
                </div>
                <div className="metric-card">
                  <span>Paycheck 2 left</span>
                  <strong>{money.format(plan.secondWindow.left)}</strong>
                </div>
              </div>
            </CanvasPanelCard>

            <CanvasPanelCard
              meta={
                <div>
                  <span>Cloud</span>
                  <strong>{cloudStatusLabel}</strong>
                </div>
              }
              onActivate={() => {
                activateTarget('panel', 'controls');
              }}
              onStartInteraction={startInteraction('panel', 'controls', form.panels.controls.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'controls'));
              }}
              panel={form.panels.controls}
              subtitle="Open workspace settings, reset the canvas, or switch appearance"
              title="Controls"
            >
              <div className="button-stack">
                <button
                  className="ghost-button"
                  onClick={() => {
                    setEditorOpen(true);
                  }}
                  type="button"
                >
                  Workspace setup
                </button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setForm((current) => resetCanvasLayout(current));
                  }}
                  type="button"
                >
                  Reset canvas
                </button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setCloudErrorMessage(null);
                    setCloudInfoMessage(
                      authUser ? `Signed in as ${authUser.email ?? 'current user'}.` : 'Sign in to sync this workspace.',
                    );
                    setCloudModalOpen(true);
                  }}
                  type="button"
                >
                  Cloud sync
                </button>
                <button
                  className="primary-button"
                  onClick={() => {
                    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
                  }}
                  type="button"
                >
                  {theme === 'light' ? 'Dark mode' : 'Light mode'}
                </button>
              </div>
              <div className="metric-grid compact">
                <div className="metric-card">
                  <span>Local save</span>
                  <strong>Always on</strong>
                </div>
                <div className="metric-card">
                  <span>Cloud account</span>
                  <strong>{authUser?.email ?? (isSupabaseConfigured ? 'Not signed in' : 'Not configured')}</strong>
                </div>
                <div className={`metric-card sync-metric sync-metric-${cloudStatusTone}`}>
                  <span>Cloud status</span>
                  <strong>{cloudStatusLabel}</strong>
                  <small>{cloudStatusDetail}</small>
                </div>
                <div className="metric-card">
                  <span>Last cloud sync</span>
                  <strong>{lastSyncLabel}</strong>
                  <small>{lastCloudSyncedAt ? 'Latest saved workspace version' : 'No cloud save yet'}</small>
                </div>
                <div className={`metric-card sync-metric sync-metric-${updaterTone}`}>
                  <span>App updates</span>
                  <strong>{updaterLabel}</strong>
                  <small>{updaterState.message}</small>
                </div>
                <div className="metric-card">
                  <span>Installed version</span>
                  <strong>{installedVersionLabel}</strong>
                  <small>{latestVersionLabel}</small>
                </div>
              </div>
              <div className="button-stack">
                <button
                  className="ghost-button"
                  disabled={updaterState.status === 'checking'}
                  onClick={handleCheckForUpdates}
                  type="button"
                >
                  {updaterActionLabel}
                </button>
                {updaterState.canInstall ? (
                  <button className="primary-button" onClick={handleInstallUpdate} type="button">
                    Restart to install update
                  </button>
                ) : null}
              </div>
            </CanvasPanelCard>

            <CanvasPanelCard
              meta={
                <div>
                  <span>Focus</span>
                  <strong>{plan.focusDebt?.name ?? 'None'}</strong>
                </div>
              }
              onActivate={() => {
                activateTarget('panel', 'signals');
              }}
              onStartInteraction={startInteraction('panel', 'signals', form.panels.signals.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'signals'));
              }}
              panel={form.panels.signals}
              subtitle="Pressure points, carry-forward reserves, and due-date suggestions"
              title="Routing signals"
            >
              <div className="insight-stack">
                <div className="insight-row">
                  <span>Paycheck 1 pressure</span>
                  <strong>{money.format(plan.firstWindowPressurePool)}</strong>
                </div>
                <div className="insight-row">
                  <span>Paycheck 2 pressure</span>
                  <strong>{money.format(plan.secondWindowPressurePool)}</strong>
                </div>
                <div className="insight-row">
                  <span>Carry into paycheck 2</span>
                  <strong>{money.format(plan.firstWindowCarryTotal)}</strong>
                </div>
                <div className="insight-row">
                  <span>Projected payoff</span>
                  <strong>{plan.payoffMonth ?? 'Open horizon'}</strong>
                </div>
                {plan.dueDateSuggestions.length > 0 ? (
                  <div className="signal-callout">
                    <p className="eyebrow">Due-date idea</p>
                    <p className="signal-copy">
                      Target about {money.format(plan.suggestionTargetRelief)} of relief from paycheck 1 by moving one
                      or more realistic first-window due dates.
                    </p>
                    {plan.dueDateSuggestions.map((suggestion) => (
                      <p className="signal-copy" key={suggestion.id}>
                        {suggestion.copy}
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="signal-callout">
                    <p className="eyebrow">Due-date idea</p>
                    <p className="signal-copy">
                      {plan.hasFirstWindowPressureIssue
                        ? `The first paycheck is tight, but the biggest pressure is coming from fixed items like ${
                            plan.fixedFirstWindowItems.map((item) => item.label).join(', ') || 'rent and core bills'
                          }.`
                        : 'The two paycheck windows are reasonably balanced right now.'}
                    </p>
                    {plan.hasFirstWindowPressureIssue && plan.firstWindowCoverageGap > 0 ? (
                      <p className="signal-copy">
                        Paycheck 1 is currently short by about {money.format(plan.firstWindowCoverageGap)} before any
                        due-date changes.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </CanvasPanelCard>

            <SplitLedgerCard
              bills={form.splitBills}
              onActivate={() => {
                activateTarget('panel', 'splitLedger');
              }}
              onStartInteraction={startInteraction('panel', 'splitLedger', form.panels.splitLedger.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'splitLedger'));
              }}
              panel={form.panels.splitLedger}
            />

            <WindowCard
              allocation={plan.firstWindow}
              onActivate={() => {
                activateTarget('panel', 'firstWindow');
              }}
              onStartInteraction={startInteraction('panel', 'firstWindow', form.panels.firstWindow.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'firstWindow'));
              }}
              panel={form.panels.firstWindow}
            />

            <WindowCard
              allocation={plan.secondWindow}
              onActivate={() => {
                activateTarget('panel', 'secondWindow');
              }}
              onStartInteraction={startInteraction('panel', 'secondWindow', form.panels.secondWindow.layout)}
              onToggleCollapse={() => {
                setForm((current) => toggleCollapse(current, 'panel', 'secondWindow'));
              }}
              panel={form.panels.secondWindow}
            />

            {plan.rollups.map((rollup) => {
              const debt = form.debts.find((item) => item.id === rollup.debtId);

              if (!debt) {
                return null;
              }

              return (
                <DebtCard
                  debt={debt}
                  key={debt.id}
                  onActivate={() => {
                    activateTarget('debt', debt.id);
                  }}
                  onStartInteraction={startInteraction('debt', debt.id, debt.layout)}
                  onToggleCollapse={() => {
                    setForm((current) => toggleCollapse(current, 'debt', debt.id));
                  }}
                  rollup={rollup}
                />
              );
            })}
          </div>
        </section>
      </main>

      <CloudSyncModal
        email={authEmail}
        errorMessage={cloudErrorMessage}
        infoMessage={cloudInfoMessage}
        isBootstrapping={isCloudBootstrapping}
        isConfigured={isSupabaseConfigured}
        isLoading={isCloudBusy}
        isOpen={isCloudModalOpen}
        lastSyncedAt={lastCloudSyncedAt}
        mode={authMode}
        onClose={() => {
          setCloudModalOpen(false);
        }}
        onEmailChange={setAuthEmail}
        onLoadCloud={handleLoadCloud}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setCloudErrorMessage(null);
          setCloudInfoMessage(null);
        }}
        onPasswordChange={setAuthPassword}
        onSignOut={handleCloudSignOut}
        onSubmit={handleCloudAuthSubmit}
        onSyncNow={handleSyncNow}
        password={authPassword}
        user={authUser}
      />

      <EditorModal
        form={form}
        isOpen={isEditorOpen}
        onAddDebtModel={addDebtModel}
        onAddSplitItem={addSplitItem}
        onChange={setForm}
        onClose={() => {
          setEditorOpen(false);
        }}
      />
    </>
  );
}

export default App;
