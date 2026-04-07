export type SourceSystem = "ETRADE" | "CARTA" | "GENERIC";
export type FileType =
  | "Grant Activity"
  | "Expense Report"
  | "Org Mapping"
  | "Manual Tracker";

export type PeriodKey = "current" | "previous";

export type MappingStatus =
  | "Suggested"
  | "Confirmed"
  | "Ignored"
  | "Custom"
  | "Unmapped";

export type Confidence = "High" | "Medium" | "Low";

export type NormalizedFieldCategory =
  | "core"
  | "dates"
  | "amounts"
  | "dimensions"
  | "performance"
  | "custom";

export type NormalizedField = {
  key: string;
  label: string;
  description: string;
  requiredFor: FileType[];
  suggestedFor: FileType[];
  category: NormalizedFieldCategory;
  synonyms: string[];
};

export type MappingDecision = {
  sourceColumn: string;
  normalizedFieldKey: string | null;
  normalizedFieldLabel: string | null;
  status: MappingStatus;
  confidence: Confidence | null;
  ignored: boolean;
  sampleValues: string[];
  notes?: string;
};

export type ParsedCsvData = {
  rows: string[][];
  maxColumnCount: number;
};

export type DetectionResult = {
  sourceSystem: SourceSystem;
  confidence: Confidence;
  matchedSignals: string[];
};

export type NormalizedExpenseRow = {
  rowNumber: number;
  sourceFileName: string;
  sourceSystem: SourceSystem;
  employeeName: string | null;
  employeeId: string | null;
  grantNumber: string | null;
  awardType: string | null;
  legalEntity: string | null;
  department: string | null;
  costCenter: string | null;
  country: string | null;
  currentPeriodExpense: number | null;
  cumulativeExpense: number | null;
  expenseStartDate: string | null;
  servicePeriodEnd: string | null;
};

export type SummaryBucket = {
  label: string;
  amount: number;
  count: number;
};

export type ExpenseSummary = {
  totalExpense: number;
  rowCount: number;
  expenseRowCount: number;
  byLegalEntity: SummaryBucket[];
  byDepartment: SummaryBucket[];
  byCountry: SummaryBucket[];
  byAwardType: SummaryBucket[];
  topRows: NormalizedExpenseRow[];
};

export type ComparisonBucket = {
  label: string;
  currentAmount: number;
  previousAmount: number;
  varianceAmount: number;
  variancePercent: number | null;
  currentCount: number;
  previousCount: number;
};

export type ExpenseComparison = {
  currentPeriodLabel: string;
  previousPeriodLabel: string;
  currentTotal: number;
  previousTotal: number;
  varianceAmount: number;
  variancePercent: number | null;
  byLegalEntity: ComparisonBucket[];
  byDepartment: ComparisonBucket[];
  byCountry: ComparisonBucket[];
  byAwardType: ComparisonBucket[];
};

export type TemplateMappingSetting = {
  normalizedFieldKey: string | null;
  normalizedFieldLabel: string | null;
  status: MappingStatus;
  confidence: Confidence | null;
  ignored: boolean;
};

export type ReusableTemplate = {
  id: string;
  name: string;
  signature: string;
  sourceSystem: SourceSystem;
  fileType: FileType;
  headerRowIndex: number;
  createdAt: string;
  updatedAt: string;
  mappingSettings: TemplateMappingSetting[];
  customFieldNames: Record<number, string>;
};
