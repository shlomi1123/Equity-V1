import type {
  ComparisonBucket,
  ExpenseComparison,
  NormalizedExpenseRow,
} from "@/lib/equity-close/types";

function computeVariancePercent(
  currentAmount: number,
  previousAmount: number,
): number | null {
  if (previousAmount === 0 && currentAmount === 0) {
    return 0;
  }

  if (previousAmount === 0) {
    return null;
  }

  return ((currentAmount - previousAmount) / Math.abs(previousAmount)) * 100;
}

function buildBucketMap(
  rows: NormalizedExpenseRow[],
  selector: (row: NormalizedExpenseRow) => string | null,
): Map<string, { amount: number; count: number }> {
  const map = new Map<string, { amount: number; count: number }>();

  rows.forEach((row) => {
    if (row.currentPeriodExpense === null) return;

    const label = selector(row) ?? "Unassigned";
    const existing = map.get(label);

    if (existing) {
      existing.amount += row.currentPeriodExpense;
      existing.count += 1;
      return;
    }

    map.set(label, {
      amount: row.currentPeriodExpense,
      count: 1,
    });
  });

  return map;
}

function compareByDimension(
  currentRows: NormalizedExpenseRow[],
  previousRows: NormalizedExpenseRow[],
  selector: (row: NormalizedExpenseRow) => string | null,
): ComparisonBucket[] {
  const currentMap = buildBucketMap(currentRows, selector);
  const previousMap = buildBucketMap(previousRows, selector);

  const labels = new Set<string>([
    ...Array.from(currentMap.keys()),
    ...Array.from(previousMap.keys()),
  ]);

  return Array.from(labels)
    .map((label) => {
      const current = currentMap.get(label) ?? { amount: 0, count: 0 };
      const previous = previousMap.get(label) ?? { amount: 0, count: 0 };

      return {
        label,
        currentAmount: current.amount,
        previousAmount: previous.amount,
        varianceAmount: current.amount - previous.amount,
        variancePercent: computeVariancePercent(current.amount, previous.amount),
        currentCount: current.count,
        previousCount: previous.count,
      };
    })
    .sort((a, b) => Math.abs(b.varianceAmount) - Math.abs(a.varianceAmount))
    .slice(0, 8);
}

export function buildExpenseComparison(params: {
  currentRows: NormalizedExpenseRow[];
  previousRows: NormalizedExpenseRow[];
  currentPeriodLabel: string;
  previousPeriodLabel: string;
}): ExpenseComparison {
  const { currentRows, previousRows, currentPeriodLabel, previousPeriodLabel } =
    params;

  const currentExpenseRows = currentRows.filter(
    (row) => row.currentPeriodExpense !== null,
  );
  const previousExpenseRows = previousRows.filter(
    (row) => row.currentPeriodExpense !== null,
  );

  const currentTotal = currentExpenseRows.reduce(
    (sum, row) => sum + (row.currentPeriodExpense ?? 0),
    0,
  );

  const previousTotal = previousExpenseRows.reduce(
    (sum, row) => sum + (row.currentPeriodExpense ?? 0),
    0,
  );

  const varianceAmount = currentTotal - previousTotal;

  return {
    currentPeriodLabel,
    previousPeriodLabel,
    currentTotal,
    previousTotal,
    varianceAmount,
    variancePercent: computeVariancePercent(currentTotal, previousTotal),
    byLegalEntity: compareByDimension(
      currentExpenseRows,
      previousExpenseRows,
      (row) => row.legalEntity,
    ),
    byDepartment: compareByDimension(
      currentExpenseRows,
      previousExpenseRows,
      (row) => row.department,
    ),
    byCountry: compareByDimension(
      currentExpenseRows,
      previousExpenseRows,
      (row) => row.country,
    ),
    byAwardType: compareByDimension(
      currentExpenseRows,
      previousExpenseRows,
      (row) => row.awardType,
    ),
  };
}
