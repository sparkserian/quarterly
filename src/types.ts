export type PayWindow = 'first' | 'second';
export type PayFrequency = 'weekly' | 'biweekly' | 'semi-monthly' | 'monthly';
export type SplitBillKind =
  | 'rent'
  | 'utility'
  | 'internet'
  | 'phone'
  | 'transportation'
  | 'insurance'
  | 'subscription'
  | 'groceries'
  | 'medical'
  | 'credit-card'
  | 'personal-loan'
  | 'auto-loan'
  | 'student-loan'
  | 'line-of-credit'
  | 'other';
export type DebtKind =
  | 'credit-card'
  | 'personal-loan'
  | 'auto-loan'
  | 'student-loan'
  | 'line-of-credit'
  | 'medical-debt'
  | 'other';
export type CanvasPanelId =
  | 'overview'
  | 'summary'
  | 'controls'
  | 'signals'
  | 'splitLedger'
  | 'firstWindow'
  | 'secondWindow';

export interface DebtLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface Debt {
  id: string;
  name: string;
  kind: DebtKind;
  sourceSplitBillId?: string | null;
  balance: number;
  apr: number;
  interestRate: number;
  minimumPayment: number;
  dueDay: number;
  dueWindow: PayWindow;
  collapsed: boolean;
  layout: DebtLayout;
}

export interface CanvasPanelState {
  collapsed: boolean;
  layout: DebtLayout;
}

export interface IncomeProfile {
  payFrequency: PayFrequency;
  firstPaycheckAmount: number;
  secondPaycheckAmount: number;
  extraIncome: number;
  windowCutoffDay: number;
}

export interface SpendingProfile {
  firstWindowPersonalSpend: number;
  secondWindowPersonalSpend: number;
}

export interface SplitBill {
  id: string;
  name: string;
  kind: SplitBillKind;
  category: string;
  dueDay: number | null;
  totalAmount: number;
  firstWindowAmount: number;
  secondWindowAmount: number;
  notes: string;
}

export interface PlannerForm {
  planName: string;
  income: IncomeProfile;
  spending: SpendingProfile;
  splitBills: SplitBill[];
  panels: Record<CanvasPanelId, CanvasPanelState>;
  debts: Debt[];
}

export interface DebtTimelineEntry {
  month: string;
  owed: number;
  paid: number;
  left: number;
  percentLeft: number;
}

export interface DebtRollup {
  debtId: string;
  debtName: string;
  apr: number;
  startingBalance: number;
  dueWindow: PayWindow;
  minimumPayment: number;
  timeline: DebtTimelineEntry[];
  payoffMonth: string | null;
}

export interface WindowAllocationItem {
  id: string;
  label: string;
  amount: number;
  type: 'income' | 'bill' | 'debt' | 'spend' | 'carry';
}

export interface WindowAllocation {
  title: string;
  income: number;
  spend: number;
  reserve: number;
  debtPayments: number;
  minimumDebtPayments: number;
  extraDebtPayments: number;
  committed: number;
  left: number;
  items: WindowAllocationItem[];
}
