import type {
  ExpenseSummary,
  MappingDecision,
  NormalizedExpenseRow,
  SourceSystem,
  SummaryBucket,
} from "@/lib/equity-close/types";

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : null;
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => String(cell ?? "").trim().length === 0);
}

export function parseAmount(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();

  if (!raw || raw === "-" || raw === "—") {
    return null;
  }

  let next = raw;
  let isNegative = false;

  if (next.startsWith("(") && next.endsWith(")")) {
    isNegative = true;
    next = next.slice(1, -1);
  }

  if (/-\s*$/.test(next)) {
    isNegative = true;
    next = next.replace(/-\s*$/, "");
  }

  if (/\bCR\b/i.test(next)) {
    isNegative = true;
    next = next.replace(/\bCR\b/gi, "");
  }

  if (/\bDR\b/i.test(next)) {
    next = next.replace(/\bDR\b/gi, "");
  }

  next = next
    .replace(/[$€£¥₪]/g, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  next = next.replace(/[A-Za-z]/g, "");

  if (!next) {
    return null;
  }

  if (next.includes(",") && !next.includes(".")) {
    next = next.replace(",", ".");
  }

  const parsed = Number(next);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isNegative ? -parsed : parsed;
}

function getMappedTextValue(
  row: string[],
  mappings: MappingDecision[],
  fieldKey: string,
): string | null {
  for (let index = 0; index < mappings.length; index += 1) {
    const mapping = mappings[index];

    if (mapping.ignored) continue;
    if (mapping.normalizedFieldKey !== fieldKey) continue;

    const value = normalizeText(row[index] ?? "");
    if (value) return value;
  }

  return null;
}

function isLikelySummaryRow(record: NormalizedExpenseRow): boolean {
  const textFields = [
    record.employeeName,
    record.employeeId,
    record.grantNumber,
    record.awardType,
    record.legalEntity,
    record.department,
    record.country,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!textFields) return false;

  const hasTotalSignal = /\b(total|subtotal|grand total)\b/.test(textFields);
  const hasIdentifiers = Boolean(record.employeeId || record.grantNumber);

  return hasTotalSignal && !hasIdentifiers;
}

function aggregateByDimension(
  rows: NormalizedExpenseRow[],
  selector: (row: NormalizedExpenseRow) => string | null,
): SummaryBucket[] {
  const bucketMap = new Map<string, SummaryBucket>();

  rows.forEach((row) => {
    if (row.currentPeriodExpense === null) return;

    const label = selector(row) ?? "Unassigned";
    const existing = bucketMap.get(label);

    if (existing) {
      existing.amount += row.currentPeriodExpense;
      existing.count += 1;
      return;
    }

    bucketMap.set(label, {
      label,
      amount: row.currentPeriodExpense,
      count: 1,
    });
  });

  return Array.from(bucketMap.values()).sort((a, b) => {
    const amountDelta = Math.abs(b.amount) - Math.abs(a.amount);
    if (amountDelta !== 0) return amountDelta;

    return b.count - a.count;
  });
}

export function buildNormalizedExpenseRows(params: {
  rows: string[][];
  headerRowIndex: number;
  mappings: MappingDecision[];
  sourceSystem: SourceSystem;
  sourceFileName: string;
}): NormalizedExpenseRow[] {
  const { rows, headerRowIndex, mappings, sourceSystem, sourceFileName } = params;

  const dataRows = rows.slice(headerRowIndex + 1);
  const normalizedRows: NormalizedExpenseRow[] = [];

  dataRows.forEach((row, offset) => {
    if (isBlankRow(row)) return;

    const normalizedRow: NormalizedExpenseRow = {
      rowNumber: headerRowIndex + offset + 2,
      sourceFileName,
      sourceSystem,
      employeeName: getMappedTextValue(row, mappings, "employee_name"),
      employeeId: getMappedTextValue(row, mappings, "employee_id"),
      grantNumber: getMappedTextValue(row, mappings, "grant_number"),
      awardType: getMappedTextValue(row, mappings, "award_type"),
      legalEntity: getMappedTextValue(row, mappings, "legal_entity"),
      department: getMappedTextValue(row, mappings, "department"),
      costCenter: getMappedTextValue(row, mappings, "cost_center"),
      country: getMappedTextValue(row, mappings, "country"),
      currentPeriodExpense: parseAmount(
        getMappedTextValue(row, mappings, "current_period_expense"),
      ),
      cumulativeExpense: parseAmount(
        getMappedTextValue(row, mappings, "cumulative_expense"),
      ),
      expenseStartDate: getMappedTextValue(row, mappings, "expense_start_date"),
      servicePeriodEnd: getMappedTextValue(row, mappings, "service_period_end"),
    };

    const hasAnyMeaningfulValue =
      normalizedRow.employeeName ||
      normalizedRow.employeeId ||
      normalizedRow.grantNumber ||
      normalizedRow.awardType ||
      normalizedRow.legalEntity ||
      normalizedRow.department ||
      normalizedRow.costCenter ||
      normalizedRow.country ||
      normalizedRow.currentPeriodExpense !== null ||
      normalizedRow.cumulativeExpense !== null ||
      normalizedRow.expenseStartDate ||
      normalizedRow.servicePeriodEnd;

    if (!hasAnyMeaningfulValue) return;
    if (isLikelySummaryRow(normalizedRow)) return;

    normalizedRows.push(normalizedRow);
  });

  return normalizedRows;
}

export function buildExpenseSummary(
  normalizedRows: NormalizedExpenseRow[],
): ExpenseSummary {
  const expenseRows = normalizedRows.filter(
    (row) => row.currentPeriodExpense !== null,
  );

  const totalExpense = expenseRows.reduce(
    (sum, row) => sum + (row.currentPeriodExpense ?? 0),
    0,
  );

  const topRows = [...expenseRows]
    .sort(
      (a, b) =>
        Math.abs(b.currentPeriodExpense ?? 0) -
        Math.abs(a.currentPeriodExpense ?? 0),
    )
    .slice(0, 10);

  return {
    totalExpense,
    rowCount: normalizedRows.length,
    expenseRowCount: expenseRows.length,
    byLegalEntity: aggregateByDimension(expenseRows, (row) => row.legalEntity).slice(0, 8),
    byDepartment: aggregateByDimension(expenseRows, (row) => row.department).slice(0, 8),
    byCountry: aggregateByDimension(expenseRows, (row) => row.country).slice(0, 8),
    byAwardType: aggregateByDimension(expenseRows, (row) => row.awardType).slice(0, 8),
    topRows,
  };
}
