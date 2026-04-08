"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

type PeriodKey = "current" | "previous";
type SourceSystem = "ETRADE" | "CARTA" | "GENERIC";
type FileType = "Grant Activity" | "Expense Report" | "Org Mapping" | "Manual Tracker" | "Forfeitures";
type MappingStatus = "Confirmed" | "Suggested" | "Ignored" | "Custom";
type Confidence = "High" | "Medium" | "Low" | null;

type NormalizedField = {
  key: string;
  label: string;
  synonyms: string[];
};

type MappingItem = {
  columnIndex: number;
  originalHeader: string;
  sampleValues: string[];
  normalizedFieldKey: string;
  normalizedFieldLabel: string;
  status: MappingStatus;
  confidence: Confidence;
  ignored: boolean;
  customValue: string;
};

type ManualExpenseLine = {
  id: string;
  description: string;
  amount: number;
};

type ReusableTemplate = {
  id: string;
  signature: string;
  name: string;
  sourceSystem: SourceSystem;
  fileType: FileType;
  headerRowIndex: number;
  mappings: MappingItem[];
  updatedAt: string;
};

type SessionCard = {
  key: PeriodKey;
  label: string;
  fileName: string | null;
  sourceSystem: SourceSystem;
  fileType: FileType;
  rows: string[][];
  parseError: string | null;
  isParsing: boolean;
  detectedHeaderRowIndex: number | null;
  likelyHeaderRows: number[];
  headerRowIndex: number | null;
  mappings: MappingItem[];
  templateSignature: string | null;
  matchedReusableTemplateId: string | null;
  templateName: string;
  manualExpenses: ManualExpenseLine[];
};

const REUSABLE_TEMPLATE_STORAGE_KEY = "equity-close-os:mapping-profiles:v1";

const NORMALIZED_FIELDS: NormalizedField[] = [
  {
    key: "employee_name",
    label: "Employee Name",
    synonyms: ["employee name", "name", "participant name", "full name", "employee"],
  },
  {
    key: "employee_id",
    label: "Employee ID",
    synonyms: ["employee id", "emplid", "worker id", "person id", "participant id"],
  },
  {
    key: "grant_number",
    label: "Grant Number",
    synonyms: ["grant number", "grant id", "award id", "award number", "grant"],
  },
  {
    key: "award_type",
    label: "Award Type",
    synonyms: ["award type", "grant type", "equity type", "award"],
  },
  {
    key: "grant_date",
    label: "Grant Date",
    synonyms: ["grant date", "award date", "date granted"],
  },
  {
    key: "shares_granted",
    label: "Shares Granted",
    synonyms: ["shares granted", "granted shares", "units granted", "quantity granted"],
  },
  {
    key: "fair_value_per_share",
    label: "Fair Value Per Share",
    synonyms: ["fair value per share", "grant date fair value", "fv per share", "fair value"],
  },
  {
    key: "expense_start_date",
    label: "Expense Start Date",
    synonyms: ["expense start date", "recognition start date", "start date"],
  },
  {
    key: "service_date",
    label: "Service Date",
    synonyms: ["service date", "vesting service date"],
  },
  {
    key: "current_period_expense",
    label: "Current Period Expense",
    synonyms: [
      "current period expense",
      "period expense",
      "expense allocation recognition",
      "recognized expense",
      "compensation expense",
      "current expense",
    ],
  },
  {
    key: "forfeitures",
    label: "Forfeitures / Cancelled Equity",
    synonyms: [
      "forfeiture",
      "forfeitures",
      "cancel equity",
      "cancelled equity",
      "canceled equity",
      "cancelled awards",
      "canceled awards",
      "shares forfeited",
      "forfeited shares",
      "forfeited amount",
      "terminated awards",
      "termination cancellations",
    ],
  },
  {
    key: "cumulative_expense",
    label: "Cumulative Expense",
    synonyms: ["cumulative expense", "life to date expense", "ltd expense", "recognized to date"],
  },
  {
    key: "performance_status_date",
    label: "Performance Status Date",
    synonyms: ["performance status date", "status date"],
  },
  {
    key: "legal_entity",
    label: "Legal Entity",
    synonyms: ["legal entity", "entity", "company"],
  },
  {
    key: "department",
    label: "Department",
    synonyms: ["department", "dept", "function"],
  },
  {
    key: "cost_center",
    label: "Cost Center",
    synonyms: ["cost center", "cost centre", "cc"],
  },
  {
    key: "country",
    label: "Country",
    synonyms: ["country", "location country"],
  },
];

const INITIAL_SESSIONS: Record<PeriodKey, SessionCard> = {
  current: {
    key: "current",
    label: "Current period",
    fileName: null,
    sourceSystem: "ETRADE",
    fileType: "Expense Report",
    rows: [],
    parseError: null,
    isParsing: false,
    detectedHeaderRowIndex: null,
    likelyHeaderRows: [],
    headerRowIndex: null,
    mappings: [],
    templateSignature: null,
    matchedReusableTemplateId: null,
    templateName: "",
    manualExpenses: [],
  },
  previous: {
    key: "previous",
    label: "Previous period",
    fileName: null,
    sourceSystem: "ETRADE",
    fileType: "Expense Report",
    rows: [],
    parseError: null,
    isParsing: false,
    detectedHeaderRowIndex: null,
    likelyHeaderRows: [],
    headerRowIndex: null,
    mappings: [],
    templateSignature: null,
    matchedReusableTemplateId: null,
  },
};

function normalizeCsvRows(data: unknown[]): string[][] {
  return data
    .map((row) => {
      if (!Array.isArray(row)) return [];
      return row.map((cell) => String(cell ?? "").trim());
    })
    .filter((row) => row.some((cell) => cell !== ""));
}

function parseCsvFile(file: File): Promise<{ rows: string[][]; parseError: string | null }> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete(results) {
        const rawData = Array.isArray(results.data) ? results.data : [];
        resolve({
          rows: normalizeCsvRows(rawData),
          parseError: results.errors.length ? results.errors[0]?.message ?? "CSV parse warning" : null,
        });
      },
      error(error) {
        resolve({
          rows: [],
          parseError: error.message,
        });
      },
    });
  });
}

function normalizeHeaderText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isLikelyNumeric(value: string) {
  return /^[-$€£₪(),.%\d\s]+$/.test(value.trim()) && /\d/.test(value);
}

function isLikelyDate(value: string) {
  return /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(value) || /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(value);
}

function scoreHeaderRow(row: string[]) {
  const nonEmpty = row.filter((cell) => cell !== "");
  if (!nonEmpty.length) return -999;

  const uniqueCount = new Set(nonEmpty.map((cell) => cell.toLowerCase())).size;
  const numericCount = nonEmpty.filter(isLikelyNumeric).length;
  const dateCount = nonEmpty.filter(isLikelyDate).length;
  const textCount = nonEmpty.filter((cell) => /[A-Za-z]/.test(cell)).length;

  return nonEmpty.length * 4 + uniqueCount * 2 + textCount * 1.5 - numericCount * 2 - dateCount * 2;
}

function rankLikelyHeaderRows(rows: string[][]) {
  const candidates = rows.slice(0, 80).map((row, index) => {
    const nextRow = rows[index + 1] ?? [];
    const nextDataLikeCount = nextRow.filter((cell) => isLikelyNumeric(cell) || isLikelyDate(cell)).length;
    const score = scoreHeaderRow(row) + nextDataLikeCount * 2 - index * 0.03;
    return { index, score };
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.index)
    .sort((a, b) => a - b);
}

function detectBestHeaderRow(rows: string[][]) {
  const ranked = rankLikelyHeaderRows(rows);
  return ranked.length ? ranked[0] : 0;
}

function getHeaderSimilarityScore(a: string, b: string) {
  const left = normalizeHeaderText(a);
  const right = normalizeHeaderText(b);

  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 85;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  if (!union) return 0;
  return Math.round((overlap / union) * 100);
}

function getFieldSuggestionDetails(header: string) {
  const normalized = normalizeHeaderText(header);

  if (!normalized) {
    return {
      normalizedFieldKey: "",
      normalizedFieldLabel: "",
      confidence: null as Confidence,
      status: "Suggested" as MappingStatus,
      score: 0,
    };
  }

  let best:
    | {
        field: NormalizedField;
        score: number;
      }
    | undefined;

  for (const field of NORMALIZED_FIELDS) {
    for (const synonym of field.synonyms) {
      const score = getHeaderSimilarityScore(normalized, synonym);
      if (!best || score > best.score) {
        best = { field, score };
      }
    }
  }

  if (!best || best.score < 55) {
    return {
      normalizedFieldKey: "",
      normalizedFieldLabel: "",
      confidence: "Low" as Confidence,
      status: "Suggested" as MappingStatus,
      score: best?.score ?? 0,
    };
  }

  return {
    normalizedFieldKey: best.field.key,
    normalizedFieldLabel: best.field.label,
    confidence:
      best.score >= 95 ? ("High" as Confidence) : best.score >= 75 ? ("Medium" as Confidence) : ("Low" as Confidence),
    status: "Suggested" as MappingStatus,
    score: best.score,
  };
}

function detectFieldSuggestion(header: string) {
  const result = getFieldSuggestionDetails(header);
  return {
    normalizedFieldKey: result.normalizedFieldKey,
    normalizedFieldLabel: result.normalizedFieldLabel,
    confidence: result.confidence,
    status: result.status,
  };
}

function getDerivedTable(rows: string[][], headerRowIndex: number | null) {
  if (!rows.length || headerRowIndex === null || !rows[headerRowIndex]) {
    return {
      header: [] as string[],
      dataRows: [] as string[][],
      previewRows: [] as string[][],
      dataRowCount: 0,
      columnCount: 0,
    };
  }

  const header = rows[headerRowIndex];
  const dataRows = rows.slice(headerRowIndex + 1);
  const previewRows = dataRows.slice(0, 8);
  const columnCount = Math.max(header.length, ...dataRows.slice(0, 8).map((row) => row.length), 0);

  return {
    header,
    dataRows,
    previewRows,
    dataRowCount: dataRows.length,
    columnCount,
  };
}

function buildMappings(rows: string[][], headerRowIndex: number | null) {
  const derived = getDerivedTable(rows, headerRowIndex);

  return Array.from({ length: derived.columnCount }, (_, columnIndex) => {
    const originalHeader = derived.header[columnIndex] || `Column ${columnIndex + 1}`;
    const suggestion = detectFieldSuggestion(originalHeader);
    const sampleValues = derived.dataRows
      .slice(0, 3)
      .map((row) => row[columnIndex] || "")
      .filter(Boolean);

    return {
      columnIndex,
      originalHeader,
      sampleValues,
      normalizedFieldKey: suggestion.normalizedFieldKey,
      normalizedFieldLabel: suggestion.normalizedFieldLabel,
      status: suggestion.status,
      confidence: suggestion.confidence,
      ignored: false,
      customValue: "",
    } satisfies MappingItem;
  });
}

function getTemplateSignature(sourceSystem: SourceSystem, fileType: FileType, header: string[]) {
  const normalizedHeader = header.map((item) => normalizeHeaderText(item || "")).join("|");
  return `${sourceSystem}::${fileType}::${normalizedHeader}`;
}

function applySavedMapping(base: MappingItem, saved: MappingItem, confidence?: Confidence) {
  return {
    ...base,
    normalizedFieldKey: saved.normalizedFieldKey,
    normalizedFieldLabel: saved.normalizedFieldLabel,
    status: saved.status,
    ignored: saved.ignored,
    customValue: saved.customValue,
    confidence: confidence ?? saved.confidence,
  };
}

function applyTemplateMappings(baseMappings: MappingItem[], template: ReusableTemplate | undefined) {
  if (!template) return baseMappings;

  const exactByHeader = new Map(
    template.mappings.map((mapping) => [normalizeHeaderText(mapping.originalHeader), mapping]),
  );
  const byColumnIndex = new Map(
    template.mappings.map((mapping) => [mapping.columnIndex, mapping]),
  );

  const usedSavedKeys = new Set<string>();

  return baseMappings.map((mapping) => {
    const normalizedHeader = normalizeHeaderText(mapping.originalHeader);
    const exact = exactByHeader.get(normalizedHeader);
    if (exact) {
      usedSavedKeys.add(`header:${normalizeHeaderText(exact.originalHeader)}`);
      return applySavedMapping(mapping, exact, "High");
    }

    let bestSimilar:
      | {
          mapping: MappingItem;
          score: number;
        }
      | undefined;

    for (const saved of template.mappings) {
      const savedKey = `header:${normalizeHeaderText(saved.originalHeader)}`;
      if (usedSavedKeys.has(savedKey)) continue;

      const score = getHeaderSimilarityScore(mapping.originalHeader, saved.originalHeader);
      if (score >= 60 && (!bestSimilar || score > bestSimilar.score)) {
        bestSimilar = { mapping: saved, score };
      }
    }

    if (bestSimilar) {
      usedSavedKeys.add(`header:${normalizeHeaderText(bestSimilar.mapping.originalHeader)}`);
      return applySavedMapping(
        mapping,
        bestSimilar.mapping,
        bestSimilar.score >= 90 ? "High" : bestSimilar.score >= 75 ? "Medium" : "Low",
      );
    }

    const sameSuggestedField = template.mappings.find((saved) => {
      const baseSuggestion = getFieldSuggestionDetails(mapping.originalHeader);
      const savedSuggestion = getFieldSuggestionDetails(saved.originalHeader);

      return (
        baseSuggestion.normalizedFieldKey &&
        savedSuggestion.normalizedFieldKey &&
        baseSuggestion.normalizedFieldKey === savedSuggestion.normalizedFieldKey &&
        saved.status !== "Ignored"
      );
    });

    if (sameSuggestedField) {
      return applySavedMapping(mapping, sameSuggestedField, "Low");
    }

    const byPosition = byColumnIndex.get(mapping.columnIndex);
    if (byPosition) {
      return applySavedMapping(mapping, byPosition, "Low");
    }

    return mapping;
  });
}

function parseMoneyLike(value: string) {
  const cleaned = value.replace(/[$,₪€£()%\s]/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDelta(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)}`;
}

function formatPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}
function SessionPanel({
  session,
  isActive,
  onActivate,
  onFilePick,
  onSourceChange,
  onFileTypeChange,
}: {
  session: SessionCard;
  isActive: boolean;
  onActivate: () => void;
  onFilePick: (file: File | null) => void;
  onSourceChange: (value: SourceSystem) => void;
  onFileTypeChange: (value: FileType) => void;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className={`w-full rounded-3xl border p-5 text-left transition ${
        isActive
          ? "border-slate-900 bg-slate-900 text-white shadow-lg"
          : "border-slate-200 bg-white text-slate-900 shadow-sm hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-medium uppercase tracking-[0.2em] ${isActive ? "text-slate-300" : "text-slate-500"}`}>
            {session.label}
          </p>
          <h2 className="mt-2 text-xl font-semibold">Upload file</h2>
          <p className={`mt-2 break-all text-sm ${isActive ? "text-slate-300" : "text-slate-600"}`}>
            {session.fileName ?? "No file selected yet"}
          </p>
        </div>

        <div className={`rounded-full px-3 py-1 text-xs font-medium ${isActive ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
          {session.isParsing ? "Parsing..." : isActive ? "Active" : "Standby"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className={`mb-2 block text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>Source system</span>
          <select
            value={session.sourceSystem}
            onChange={(e) => onSourceChange(e.target.value as SourceSystem)}
            className={`w-full rounded-2xl border px-3 py-2 text-sm outline-none ${isActive ? "border-white/15 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-900"}`}
          >
            <option value="ETRADE">ETRADE</option>
            <option value="CARTA">CARTA</option>
            <option value="GENERIC">GENERIC</option>
          </select>
        </label>

        <label className="block">
          <span className={`mb-2 block text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>File type</span>
          <select
            value={session.fileType}
            onChange={(e) => onFileTypeChange(e.target.value as FileType)}
            className={`w-full rounded-2xl border px-3 py-2 text-sm outline-none ${isActive ? "border-white/15 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-900"}`}
          >
            <option value="Grant Activity">Grant Activity</option>
            <option value="Expense Report">Expense Report</option>
            <option value="Org Mapping">Org Mapping</option>
            <option value="Manual Tracker">Manual Tracker</option>
            <option value="Forfeitures">Forfeitures</option>
            <option value="Forfeitures">Forfeitures</option>
          </select>
        </label>
      </div>

      <label className={`mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-sm ${isActive ? "border-white/20 bg-white/5 text-white" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => onFilePick(e.target.files?.[0] ?? null)}
        />
        Choose CSV file
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className={`rounded-2xl p-3 ${isActive ? "bg-white/5" : "bg-slate-50"}`}>
          <p className={`text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>Rows</p>
          <p className="mt-1 text-lg font-semibold">{session.rows.length || 0}</p>
        </div>

        <div className={`rounded-2xl p-3 ${isActive ? "bg-white/5" : "bg-slate-50"}`}>
          <p className={`text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>Mapped columns</p>
          <p className="mt-1 text-lg font-semibold">{session.mappings.length || 0}</p>
        </div>

        <div className={`rounded-2xl p-3 ${isActive ? "bg-white/5" : "bg-slate-50"}`}>
          <p className={`text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>Header row</p>
          <p className="mt-1 text-sm font-semibold">
            {session.headerRowIndex === null ? "—" : `Row ${session.headerRowIndex + 1}`}
          </p>
        </div>

        <div className={`rounded-2xl p-3 ${isActive ? "bg-white/5" : "bg-slate-50"}`}>
          <p className={`text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>Template match</p>
          <p className="mt-1 text-sm font-semibold">
            {session.matchedReusableTemplateId ? "Matched or applied" : "New"}
          </p>
        </div>
      </div>

      {session.parseError ? (
        <div className={`mt-4 rounded-2xl border px-3 py-2 text-sm ${isActive ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {session.parseError}
        </div>
      ) : null}
    </button>
  );
}

function HeaderControlBar({
  session,
  onUseDetected,
  onHeaderRowChange,
}: {
  session: SessionCard;
  onUseDetected: () => void;
  onHeaderRowChange: (index: number) => void;
}) {
  return (
    
      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Manual expenses</p>
            <p className="mt-1 text-sm text-slate-600">
              Add period expenses handled outside E*TRADE (description + amount).
            </p>
          </div>
          <button
            type="button"
            onClick={() => addManualExpenseLine(activePeriod)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            + Add line
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {(activeSession.manualExpenses ?? []).map((item) => (
            <div key={item.id} className="grid grid-cols-12 gap-2">
              <input
                value={item.description}
                onChange={(e) => updateManualExpenseLine(activePeriod, item.id, { description: e.target.value })}
                placeholder="Description"
                className="col-span-8 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={item.amount}
                onChange={(e) => updateManualExpenseLine(activePeriod, item.id, { amount: Number(e.target.value) || 0 })}
                placeholder="Amount"
                className="col-span-3 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => removeManualExpenseLine(activePeriod, item.id)}
                className="col-span-1 rounded-xl border border-red-200 text-xs text-red-600 hover:bg-red-50"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <p className="mt-3 text-sm text-slate-700">
          Manual subtotal ({activePeriod === "current" ? "Current" : "Previous"}):
          {" "}
          {formatNumber((activeSession.manualExpenses ?? []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}
        </p>
      </div>

<section className="rounded-3xl border border-slate-200 bg-[#fcfcfa] p-4">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Header control</p>
          <h2 className="mt-2 text-xl font-semibold">{session.label}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Compact control instead of a large row-picker panel.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Detected row</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {session.detectedHeaderRowIndex === null ? "—" : `Row ${session.detectedHeaderRowIndex + 1}`}
          </p>
        </div>

        <label className="rounded-2xl border border-slate-200 bg-white p-3">
          <span className="block text-xs text-slate-500">Selected row</span>
          <input
            type="number"
            min={1}
            max={Math.max(session.rows.length, 1)}
            value={session.headerRowIndex === null ? "" : session.headerRowIndex + 1}
            onChange={(e) => {
              const nextValue = Number(e.target.value);
              if (!Number.isFinite(nextValue) || nextValue < 1 || nextValue > session.rows.length) return;
              onHeaderRowChange(nextValue - 1);
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="rounded-2xl border border-slate-200 bg-white p-3">
          <span className="block text-xs text-slate-500">Likely rows</span>
          <select
            value={session.headerRowIndex ?? ""}
            onChange={(e) => onHeaderRowChange(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
          >
            {session.likelyHeaderRows.map((index) => (
              <option key={index} value={index}>
                Row {index + 1}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onUseDetected}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
          >
            Use detected
          </button>
        </div>
      </div>
    </section>
  );
}

function TemplateActionBar({
  session,
  compatibleTemplates,
  selectedTemplateId,
  onSelectedTemplateIdChange,
  onTemplateNameChange,
  onSaveActiveTemplate,
  onApplySelectedTemplate,
  copyLabel,
  onCopyFromOtherPeriod,
}: {
  session: SessionCard;
  compatibleTemplates: ReusableTemplate[];
  selectedTemplateId: string;
  onSelectedTemplateIdChange: (value: string) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveActiveTemplate: () => void;
  onApplySelectedTemplate: () => void;
  copyLabel: string;
  onCopyFromOtherPeriod: () => void;
}) {
  const canApplySavedTemplate = Boolean(selectedTemplateId);

  return (
    <section className="rounded-3xl border border-slate-200 bg-[#fcfcfa] p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto_auto]">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Template actions</p>
          <h2 className="mt-2 text-xl font-semibold">{session.label}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Save a reusable mapping, apply one from the library, or copy from the other open file.
          </p>
        </div>

        <label className="rounded-2xl border border-slate-200 bg-white p-3">
          <span className="block text-xs text-slate-500">Reusable template name</span>
          <input
            type="text"
            value={session.templateName ?? ""}
            onChange={(e) => onTemplateNameChange(e.target.value)}
            placeholder={`${session.sourceSystem} ${session.fileType}`}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="rounded-2xl border border-slate-200 bg-white p-3">
          <span className="block text-xs text-slate-500">Saved reusable templates</span>
          <select
            value={selectedTemplateId}
            onChange={(e) => onSelectedTemplateIdChange(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
          >
            <option value="">Select saved template</option>
            {compatibleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} • Row {template.headerRowIndex + 1}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <button
            type="button"
            onClick={onSaveActiveTemplate}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
          >
            Save reusable template
          </button>

          <button
            type="button"
            onClick={onCopyFromOtherPeriod}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
          >
            {copyLabel}
          </button>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onApplySelectedTemplate}
            disabled={!canApplySavedTemplate}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply reusable template
          </button>
        </div>
      </div>
    </section>
  );
}

function MappingGrid({
  session,
  onSetField,
  onConfirm,
  onIgnore,
  onCustom,
  onCustomValueChange,
}: {
  session: SessionCard;
  onSetField: (columnIndex: number, fieldKey: string) => void;
  onConfirm: (columnIndex: number) => void;
  onIgnore: (columnIndex: number) => void;
  onCustom: (columnIndex: number) => void;
  onCustomValueChange: (columnIndex: number, value: string) => void;
}) {
  if (!session.mappings.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
        Upload a file and choose the header row to generate the mapping studio.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Column</th>
              <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Original header</th>
              <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Sample values</th>
              <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Mapped to</th>
              <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Status</th>
              <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Actions</th>
            </tr>
          </thead>

          <tbody>
            {session.mappings.map((mapping) => (
              <tr key={mapping.columnIndex} className="align-top odd:bg-white even:bg-slate-50/50">
                <td className="border-t border-slate-100 px-4 py-3 text-slate-500">{mapping.columnIndex + 1}</td>

                <td className="border-t border-slate-100 px-4 py-3">
                  <div className="font-medium text-slate-900">{mapping.originalHeader}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Confidence: {mapping.confidence ?? "—"}
                  </div>
                </td>

                <td className="border-t border-slate-100 px-4 py-3 text-slate-600">
                  {mapping.sampleValues.length ? mapping.sampleValues.join(" • ") : "—"}
                </td>

                <td className="border-t border-slate-100 px-4 py-3">
                  <select
                    value={mapping.status === "Custom" ? "__CUSTOM__" : mapping.normalizedFieldKey}
                    onChange={(e) => onSetField(mapping.columnIndex, e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                  >
                    <option value="">Unmapped</option>
                    {NORMALIZED_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                    <option value="__CUSTOM__">Custom field</option>
                  </select>

                  {mapping.status === "Custom" ? (
                    <input
                      type="text"
                      value={mapping.customValue}
                      onChange={(e) => onCustomValueChange(mapping.columnIndex, e.target.value)}
                      placeholder="Type custom field name"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                  ) : null}
                </td>

                <td className="border-t border-slate-100 px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                    mapping.status === "Confirmed"
                      ? "bg-emerald-50 text-emerald-700"
                      : mapping.status === "Ignored"
                      ? "bg-slate-100 text-slate-600"
                      : mapping.status === "Custom"
                      ? "bg-violet-50 text-violet-700"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {mapping.status}
                  </span>
                </td>

                <td className="border-t border-slate-100 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onConfirm(mapping.columnIndex)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => onIgnore(mapping.columnIndex)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      Ignore
                    </button>
                    <button
                      type="button"
                      onClick={() => onCustom(mapping.columnIndex)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      Custom
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewTable({
  rows,
  headerRowIndex,
}: {
  rows: string[][];
  headerRowIndex: number | null;
}) {
  const derived = getDerivedTable(rows, headerRowIndex);

  if (!derived.columnCount) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
        File preview will appear here.
      </div>
    );
  }

  const columns = Array.from({ length: derived.columnCount }, (_, index) => index);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((columnIndex) => (
                <th key={columnIndex} className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">
                  {derived.header[columnIndex] || `Column ${columnIndex + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {derived.previewRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-white even:bg-slate-50/50">
                {columns.map((columnIndex) => (
                  <td key={columnIndex} className="border-t border-slate-100 px-4 py-3 text-slate-600">
                    {row[columnIndex] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodAnalysis({
  currentSession,
  previousSession,
}: {
  currentSession: SessionCard;
  previousSession: SessionCard;
}) {
  type ComparableRecord = {
    key: string;
    label: string;
    amount: number;
    legalEntity: string;
    department: string;
    country: string;
    awardType: string;
  };

  function formatAmount(value: number, decimals = 0) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals > 0 ? decimals : 0,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  function getMappedColumnIndex(session: SessionCard, fieldKeys: string[]) {
    const found = session.mappings.find(
      (item) => fieldKeys.includes(item.normalizedFieldKey) && !item.ignored,
    );
    return found?.columnIndex ?? null;
  }

  function getFieldTotal(session: SessionCard, fieldKey: string) {
    const columnIndex = getMappedColumnIndex(session, [fieldKey]);
    if (columnIndex === null || session.headerRowIndex === null) return null;

    const derived = getDerivedTable(session.rows, session.headerRowIndex);
    return derived.dataRows.reduce((sum, row) => sum + parseMoneyLike(row[columnIndex] || ""), 0);
  }

  function parseDateCandidate(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const month = Number(slashMatch[1]);
      const day = Number(slashMatch[2]);
      const year = Number(slashMatch[3]);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dashMatch) {
      const month = Number(dashMatch[1]);
      const day = Number(dashMatch[2]);
      const year = Number(dashMatch[3]);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function inferPeriodInfo(session: SessionCard) {
    const fileName = (session.fileName || "").toLowerCase();
    const monthNames = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const monthAliases = [
      ["january", "jan"],
      ["february", "feb"],
      ["march", "mar"],
      ["april", "apr"],
      ["may"],
      ["june", "jun"],
      ["july", "jul"],
      ["august", "aug"],
      ["september", "sep", "sept"],
      ["october", "oct"],
      ["november", "nov"],
      ["december", "dec"],
    ];

    let monthIndex: number | null = null;
    for (let i = 0; i < monthAliases.length; i += 1) {
      if (monthAliases[i]!.some((alias) => fileName.includes(alias))) {
        monthIndex = i;
        break;
      }
    }

    let year: number | null = null;
    const yearMatch = fileName.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      year = Number(yearMatch[1]);
    }

    const parsedDates: Date[] = [];
    for (const row of session.rows.slice(0, 120)) {
      for (const cell of row) {
        const date = parseDateCandidate(cell);
        if (date) parsedDates.push(date);
      }
    }

    if (monthIndex === null && parsedDates.length) {
      const monthCounts = new Map<number, number>();
      for (const date of parsedDates) {
        monthCounts.set(date.getMonth(), (monthCounts.get(date.getMonth()) ?? 0) + 1);
      }

      const bestMonth = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      monthIndex = bestMonth?.[0] ?? null;
    }

    if (year === null && parsedDates.length) {
      const yearCounts = new Map<number, number>();
      for (const date of parsedDates) {
        yearCounts.set(date.getFullYear(), (yearCounts.get(date.getFullYear()) ?? 0) + 1);
      }

      const bestYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      year = bestYear?.[0] ?? null;
    }

    if (monthIndex === null || year === null) {
      return {
        monthLabel: null as string | null,
        daysInMonth: null as number | null,
      };
    }

    return {
      monthLabel: `${monthNames[monthIndex]} ${year}`,
      daysInMonth: new Date(year, monthIndex + 1, 0).getDate(),
    };
  }

  function getComparableRecords(session: SessionCard) {
    if (session.headerRowIndex === null) {
      return [] as ComparableRecord[];
    }

    const derived = getDerivedTable(session.rows, session.headerRowIndex);
    const joinKeyIndex =
      getMappedColumnIndex(session, ["grant_number"]) ??
      getMappedColumnIndex(session, ["employee_id"]) ??
      getMappedColumnIndex(session, ["employee_name"]);
    const expenseIndex = getMappedColumnIndex(session, ["current_period_expense"]);
    const labelIndex =
      getMappedColumnIndex(session, ["employee_name"]) ??
      getMappedColumnIndex(session, ["grant_number"]) ??
      getMappedColumnIndex(session, ["employee_id"]);
    const legalEntityIndex = getMappedColumnIndex(session, ["legal_entity"]);
    const departmentIndex = getMappedColumnIndex(session, ["department"]);
    const countryIndex = getMappedColumnIndex(session, ["country"]);
    const awardTypeIndex = getMappedColumnIndex(session, ["award_type"]);

    if (joinKeyIndex === null || expenseIndex === null) {
      return [] as ComparableRecord[];
    }

    return derived.dataRows
      .map((row) => {
        const key = (row[joinKeyIndex] || "").trim();
        const label = labelIndex === null ? key : ((row[labelIndex] || key).trim() || key);

        return {
          key,
          label,
          amount: parseMoneyLike(row[expenseIndex] || ""),
          legalEntity: legalEntityIndex === null ? "" : (row[legalEntityIndex] || "").trim(),
          department: departmentIndex === null ? "" : (row[departmentIndex] || "").trim(),
          country: countryIndex === null ? "" : (row[countryIndex] || "").trim(),
          awardType: awardTypeIndex === null ? "" : (row[awardTypeIndex] || "").trim(),
        };
      })
      .filter((item) => item.key);
  }

  function compareDimensionDrivers(
    field: "legalEntity" | "department" | "country" | "awardType",
  ) {
    const currentRecords = getComparableRecords(currentSession);
    const previousRecords = getComparableRecords(previousSession);

    const hasAnyDimension =
      currentRecords.some((item) => item[field]) ||
      previousRecords.some((item) => item[field]);

    if (!hasAnyDimension) {
      return [] as Array<{
        label: string;
        currentAmount: number;
        previousAmount: number;
        delta: number;
      }>;
    }

    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();

    for (const item of currentRecords) {
      const key = item[field] || "Unspecified";
      currentMap.set(key, (currentMap.get(key) ?? 0) + item.amount);
    }

    for (const item of previousRecords) {
      const key = item[field] || "Unspecified";
      previousMap.set(key, (previousMap.get(key) ?? 0) + item.amount);
    }

    const keys = Array.from(new Set([...currentMap.keys(), ...previousMap.keys()]));

    return keys
      .map((key) => {
        const currentAmount = currentMap.get(key) ?? 0;
        const previousAmount = previousMap.get(key) ?? 0;
        return {
          label: key,
          currentAmount,
          previousAmount,
          delta: currentAmount - previousAmount,
        };
      })
      .filter((item) => item.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 6);
  }

  const currentInfo = inferPeriodInfo(currentSession);
  const previousInfo = inferPeriodInfo(previousSession);

  const currentExpenseBase = getFieldTotal(currentSession, "current_period_expense");
  const previousExpenseBase = getFieldTotal(previousSession, "current_period_expense");

  const currentManualTotal = (currentSession.manualExpenses ?? []).reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0,
  );
  const previousManualTotal = (previousSession.manualExpenses ?? []).reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0,
  );

  const currentExpense =
    currentExpenseBase === null ? (currentManualTotal ? currentManualTotal : null) : currentExpenseBase + currentManualTotal;
  const previousExpense =
    previousExpenseBase === null ? (previousManualTotal ? previousManualTotal : null) : previousExpenseBase + previousManualTotal;

  const currentForfeitures = getFieldTotal(currentSession, "forfeitures");
  const previousForfeitures = getFieldTotal(previousSession, "forfeitures");

  const normalizedCurrentForfeitures = currentForfeitures === null ? null : Math.abs(currentForfeitures);
  const normalizedPreviousForfeitures = previousForfeitures === null ? null : Math.abs(previousForfeitures);

  // Positive means incremental drag vs prior period.
  const cancellationDrag =
    normalizedCurrentForfeitures !== null && normalizedPreviousForfeitures !== null
      ? normalizedCurrentForfeitures - normalizedPreviousForfeitures
      : null;

  // Keep existing variable name for downstream compatibility:
  // represent as negative effect on bridge (drag).
  const forfeitureDelta = cancellationDrag === null ? null : -Math.abs(cancellationDrag);
  const rawDelta =
    currentExpense !== null && previousExpense !== null ? currentExpense - previousExpense : null;
  const rawDeltaPercent =
    currentExpense !== null &&
    previousExpense !== null &&
    previousExpense !== 0
      ? (rawDelta! / previousExpense) * 100
      : null;

  const currentDailyRate =
    currentExpense !== null && currentInfo.daysInMonth
      ? currentExpense / currentInfo.daysInMonth
      : null;
  const previousDailyRate =
    previousExpense !== null && previousInfo.daysInMonth
      ? previousExpense / previousInfo.daysInMonth
      : null;

  const normalized30Current = currentDailyRate !== null ? currentDailyRate * 30 : null;
  const normalized30Previous = previousDailyRate !== null ? previousDailyRate * 30 : null;
  const normalized30Delta =
    normalized30Current !== null && normalized30Previous !== null
      ? normalized30Current - normalized30Previous
      : null;

  const calendarEffect =
    previousDailyRate !== null &&
    currentInfo.daysInMonth !== null &&
    previousInfo.daysInMonth !== null
      ? previousDailyRate * (currentInfo.daysInMonth - previousInfo.daysInMonth)
      : null;

  const currentRecords = getComparableRecords(currentSession);
  const previousRecords = getComparableRecords(previousSession);

  const currentByKey = new Map(currentRecords.map((item) => [item.key, item]));
  const previousByKey = new Map(previousRecords.map((item) => [item.key, item]));
  const allKeys = Array.from(new Set([...currentByKey.keys(), ...previousByKey.keys()]));

  const movers = allKeys
    .map((key) => {
      const current = currentByKey.get(key);
      const previous = previousByKey.get(key);

      return {
        key,
        label: current?.label || previous?.label || key,
        currentAmount: current?.amount ?? 0,
        previousAmount: previous?.amount ?? 0,
        delta: (current?.amount ?? 0) - (previous?.amount ?? 0),
      };
    })
    .filter((item) => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const topMovers = movers.slice(0, 8);
  const topIncreases = movers.filter((item) => item.delta > 0).slice(0, 5);
  const topDecreases = movers.filter((item) => item.delta < 0).slice(0, 5);

  const continuingKeys = allKeys.filter((key) => currentByKey.has(key) && previousByKey.has(key));
  const newKeys = allKeys.filter((key) => currentByKey.has(key) && !previousByKey.has(key));
  const missingKeys = allKeys.filter((key) => !currentByKey.has(key) && previousByKey.has(key));

  const continuingDelta = continuingKeys.reduce(
    (sum, key) => sum + ((currentByKey.get(key)?.amount ?? 0) - (previousByKey.get(key)?.amount ?? 0)),
    0,
  );
  const newRecordContribution = newKeys.reduce(
    (sum, key) => sum + (currentByKey.get(key)?.amount ?? 0),
    0,
  );
  const missingRecordContribution = missingKeys.reduce(
    (sum, key) => sum + (previousByKey.get(key)?.amount ?? 0),
    0,
  );

  const currentTopFive = [...currentRecords]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5);
  const previousTopFive = [...previousRecords]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5);

  const currentTopFiveTotal = currentTopFive.reduce((sum, item) => sum + item.amount, 0);
  const previousTopFiveTotal = previousTopFive.reduce((sum, item) => sum + item.amount, 0);

  const currentConcentration =
    currentExpense && currentExpense !== 0 ? (currentTopFiveTotal / currentExpense) * 100 : null;
  const previousConcentration =
    previousExpense && previousExpense !== 0 ? (previousTopFiveTotal / previousExpense) * 100 : null;

  const absoluteDeltas = movers.map((item) => Math.abs(item.delta)).filter((value) => value > 0);
  const sortedAbsDeltas = [...absoluteDeltas].sort((a, b) => a - b);
  const percentileIndex = sortedAbsDeltas.length
    ? Math.max(0, Math.floor(sortedAbsDeltas.length * 0.8) - 1)
    : -1;
  const outlierThreshold = percentileIndex >= 0 ? sortedAbsDeltas[percentileIndex] : null;
  const outlierMovers =
    outlierThreshold === null
      ? []
      : movers.filter((item) => Math.abs(item.delta) >= outlierThreshold).slice(0, 6);

  const entityDrivers = compareDimensionDrivers("legalEntity");
  const departmentDrivers = compareDimensionDrivers("department");
  const countryDrivers = compareDimensionDrivers("country");
  const awardTypeDrivers = compareDimensionDrivers("awardType");

  const bestDimensionDriver =
    [...entityDrivers, ...departmentDrivers, ...countryDrivers, ...awardTypeDrivers]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] ?? null;

  const topMover = topMovers[0] ?? null;

  const managementSummaryParts = [
    rawDelta === null
      ? "Map Current Period Expense in both files to unlock management summary output."
      : `Raw monthly expense moved by ${formatDelta(rawDelta)}${rawDeltaPercent === null ? "" : ` (${formatPercent(rawDeltaPercent)})`}.`,
    currentInfo.daysInMonth !== null && previousInfo.daysInMonth !== null && calendarEffect !== null
      ? `The current file appears to cover ${currentInfo.daysInMonth} days versus ${previousInfo.daysInMonth} days in the previous file, so about ${formatNumber(calendarEffect)} of the movement can be explained by calendar length alone at the prior daily run-rate.`
      : "Calendar normalization will appear once both period lengths can be inferred.",
    normalized30Delta !== null
      ? `On a 30-day normalized basis, the variance is ${formatDelta(normalized30Delta)}.`
      : "30-day normalized variance will appear once both period lengths are known.",
    newKeys.length || missingKeys.length
      ? `New records contributed ${formatDelta(newRecordContribution)}, while records that disappeared versus prior month removed ${formatNumber(missingRecordContribution)}.`
      : "New and missing record analysis will appear when the join key is mapped in both files.",
    forfeitureDelta !== null
      ? `Cancellation / forfeiture drag contributed ${formatDelta(forfeitureDelta)} (negative indicates stronger drag on expense bridge).`
      : "Map a forfeitures / cancelled equity field to quantify termination-related cancellations.",
    bestDimensionDriver
      ? `The strongest mapped business driver is ${bestDimensionDriver.label} at ${formatDelta(bestDimensionDriver.delta)}.`
      : "Map Legal Entity, Department, Country, or Award Type to identify the strongest business driver.",
    topMover
      ? `The largest single row-level mover is ${topMover.label || topMover.key} at ${formatDelta(topMover.delta)}.`
      : "Row-level mover commentary will appear when comparable keys are available.",
  ];

  const analysisQualityWarnings = [
    !getMappedColumnIndex(currentSession, ["current_period_expense"]) ||
    !getMappedColumnIndex(previousSession, ["current_period_expense"])
      ? "Map Current Period Expense in both files for reliable variance analysis."
      : null,
    !getMappedColumnIndex(currentSession, ["employee_id", "employee_name", "grant_number"]) ||
    !getMappedColumnIndex(previousSession, ["employee_id", "employee_name", "grant_number"])
      ? "Map a stable join key (Employee ID + Grant Number preferred) in both files to improve new/missing record attribution."
      : null,
    !getMappedColumnIndex(currentSession, ["forfeitures"]) ||
    !getMappedColumnIndex(previousSession, ["forfeitures"])
      ? "Map Forfeitures / Cancelled Equity in both files to quantify termination-related impact."
      : null,
  ].filter(Boolean) as string[];

  const analysisConfidenceChecks = [
    {
      label: "Current Period Expense mapped in both files",
      passed:
        !!getMappedColumnIndex(currentSession, ["current_period_expense"]) &&
        !!getMappedColumnIndex(previousSession, ["current_period_expense"]),
    },
    {
      label: "Stable join key mapped in both files",
      passed:
        !!getMappedColumnIndex(currentSession, ["employee_id", "grant_number", "employee_name"]) &&
        !!getMappedColumnIndex(previousSession, ["employee_id", "grant_number", "employee_name"]),
    },
    {
      label: "Forfeitures mapped in both files",
      passed:
        !!getMappedColumnIndex(currentSession, ["forfeitures"]) &&
        !!getMappedColumnIndex(previousSession, ["forfeitures"]),
    },
    {
      label: "Calendar days inferred for both periods",
      passed: currentInfo.daysInMonth !== null && previousInfo.daysInMonth !== null,
    },
  ];

  const passedChecks = analysisConfidenceChecks.filter((item) => item.passed).length;
  const analysisConfidenceScore = Math.round((passedChecks / analysisConfidenceChecks.length) * 100);

  const varianceBridgeRows = [
    { label: "Prior month total", value: previousExpense ?? 0 },
    { label: "Calendar effect", value: calendarEffect ?? 0 },
    { label: "Continuing-book delta", value: continuingDelta ?? 0 },
    { label: "New-record contribution", value: newRecordContribution ?? 0 },
    { label: "Missing-record drag", value: -Math.abs(missingRecordContribution ?? 0) },
    { label: "Forfeiture delta", value: forfeitureDelta ?? 0 },
    { label: "Current month total", value: currentExpense ?? 0 },
  ];

  const smartCards = [
    {
      title: "Raw delta",
      value: rawDelta === null ? "—" : formatDelta(rawDelta),
      detail: rawDeltaPercent === null ? "Monthly total change" : `Raw monthly variance • ${formatPercent(rawDeltaPercent)}`,
    },
    {
      title: "Current daily run-rate",
      value: currentDailyRate === null ? "—" : formatAmount(currentDailyRate, 1),
      detail:
        currentInfo.daysInMonth === null
          ? "Could not infer days in file"
          : `${currentInfo.daysInMonth} days • ${currentInfo.monthLabel ?? "current period"}`,
    },
    {
      title: "Previous daily run-rate",
      value: previousDailyRate === null ? "—" : formatAmount(previousDailyRate, 1),
      detail:
        previousInfo.daysInMonth === null
          ? "Could not infer days in file"
          : `${previousInfo.daysInMonth} days • ${previousInfo.monthLabel ?? "previous period"}`,
    },
    {
      title: "Calendar-only effect",
      value: calendarEffect === null ? "—" : formatDelta(calendarEffect),
      detail: "Approximate variance caused only by different month lengths",
    },
    {
      title: "30-day normalized delta",
      value: normalized30Delta === null ? "—" : formatDelta(normalized30Delta),
      detail: "Variance after normalizing both periods to 30 days",
    },
    {
      title: "Continuing-book delta",
      value: formatDelta(continuingDelta),
      detail: `${formatNumber(continuingKeys.length)} records exist in both periods`,
    },
    {
      title: "New-record contribution",
      value: formatDelta(newRecordContribution),
      detail: `${formatNumber(newKeys.length)} current-only records`,
    },
    {
      title: "Missing-record drag",
      value: `-${formatNumber(missingRecordContribution)}`,
      detail: `${formatNumber(missingKeys.length)} prior-only records`,
    },
    {
      title: "Cancellation drag",
      value: forfeitureDelta === null ? "—" : formatDelta(forfeitureDelta),
      detail:
        currentForfeitures !== null && previousForfeitures !== null
          ? `${formatNumber(currentForfeitures)} current vs ${formatNumber(previousForfeitures)} previous`
          : "Map Forfeitures / Cancelled Equity to quantify cancellation drag",
    },
    {
      title: "Current concentration",
      value: currentConcentration === null ? "—" : formatPercent(currentConcentration),
      detail: "Share of current total held by top 5 records",
    },
    {
      title: "Previous concentration",
      value: previousConcentration === null ? "—" : formatPercent(previousConcentration),
      detail: "Share of previous total held by top 5 records",
    },
    {
      title: "Largest row mover",
      value: topMover ? (topMover.label || topMover.key) : "Not available",
      detail: topMover ? formatDelta(topMover.delta) : "Map join key + expense field in both files",
    },
    {
      title: "Primary business driver",
      value: bestDimensionDriver ? bestDimensionDriver.label : "Not available",
      detail: bestDimensionDriver
        ? formatDelta(bestDimensionDriver.delta)
        : "Map entity / department / country / award type",
    },
  ];

  function renderDriverTable(
    title: string,
    rows: Array<{
      label: string;
      currentAmount: number;
      previousAmount: number;
      delta: number;
    }>,
    emptyText: string,
  ) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-medium text-slate-900">{title}</p>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Driver</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Current</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Previous</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, rowIndex) => (
                  <tr key={`${title}-${item.label}-${rowIndex}`} className="odd:bg-white even:bg-slate-50/50">
                    <td className="border-t border-slate-100 px-4 py-3 text-slate-900">{item.label}</td>
                    <td className="border-t border-slate-100 px-4 py-3 text-slate-600">{formatNumber(item.currentAmount)}</td>
                    <td className="border-t border-slate-100 px-4 py-3 text-slate-600">{formatNumber(item.previousAmount)}</td>
                    <td className="border-t border-slate-100 px-4 py-3 text-slate-900">{formatDelta(item.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-slate-500">{emptyText}</div>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-[#fcfcfa] p-5">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Period vs period</p>
      <h2 className="mt-2 text-2xl font-semibold">Analysis module</h2>
      <p className="mt-1 text-sm text-slate-600">
        Executive totals, management wording, calendar-normalized comparison, business drivers, concentration, and outlier review.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Current total</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {currentExpense === null ? "Map expense field" : formatNumber(currentExpense)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Previous total</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {previousExpense === null ? "Map expense field" : formatNumber(previousExpense)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Raw delta</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {rawDelta === null ? "—" : `${formatDelta(rawDelta)}${rawDeltaPercent === null ? "" : ` • ${formatPercent(rawDeltaPercent)}`}`}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-medium text-slate-900">Management summary</p>
        <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
          {managementSummaryParts.map((part, index) => (
            <p key={`management-summary-${index}`}>{part}</p>
          ))}
        </div>

        {analysisQualityWarnings.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">Data quality warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {analysisQualityWarnings.map((warning, idx) => (
                <li key={`analysis-warning-${idx}`}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-medium text-slate-900">Analysis confidence</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{analysisConfidenceScore}%</p>
          <p className="mt-1 text-sm text-slate-600">
            Higher score means stronger mapping coverage for period-over-period attribution.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {analysisConfidenceChecks.map((check, idx) => (
              <li key={`confidence-check-${idx}`} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${check.passed ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {check.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-medium text-slate-900">Variance bridge (executive view)</p>
          <div className="mt-3 space-y-2">
            {varianceBridgeRows.map((row, idx) => (
              <div key={`bridge-row-${idx}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <span className="text-sm text-slate-600">{row.label}</span>
                <span className="text-sm font-semibold text-slate-900">{formatDelta(row.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium text-slate-900">Executive drivers</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {smartCards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">{card.title}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{card.value}</p>
              <p className="mt-2 text-sm text-slate-600">{card.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {renderDriverTable(
          "Top increases",
          topIncreases,
          "Map the join key and current-period expense field in both files to see upward movers.",
        )}

        {renderDriverTable(
          "Top decreases",
          topDecreases,
          "Map the join key and current-period expense field in both files to see downward movers.",
        )}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {renderDriverTable(
          "Outlier movers",
          outlierMovers,
          "Large outliers will appear here once both periods are mapped.",
        )}

        {renderDriverTable(
          "Top row-level movers",
          topMovers,
          "Map the join key and current-period expense field in both files to see the largest record-level changes.",
        )}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {renderDriverTable(
          "Award type drivers",
          awardTypeDrivers,
          "Map Award Type in both files to see award-type-level drivers.",
        )}

        {renderDriverTable(
          "Entity drivers",
          entityDrivers,
          "Map Legal Entity in both files to see entity-level drivers.",
        )}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {renderDriverTable(
          "Department drivers",
          departmentDrivers,
          "Map Department in both files to see department-level drivers.",
        )}

        {renderDriverTable(
          "Country drivers",
          countryDrivers,
          "Map Country in both files to see country-level drivers.",
        )}
      </div>
    </section>
  );
}


function WorkspaceTabs({
  activeTab,
  onChange,
  mappingCount,
  previewCount,
}: {
  activeTab: "mapping" | "preview" | "analysis";
  onChange: (tab: "mapping" | "preview" | "analysis") => void;
  mappingCount: number;
  previewCount: number;
}) {
  const tabs: Array<{
    key: "mapping" | "preview" | "analysis";
    label: string;
    meta: string;
  }> = [
    {
      key: "mapping",
      label: "Mapping",
      meta: mappingCount ? `${mappingCount} columns` : "No mappings yet",
    },
    {
      key: "preview",
      label: "Preview",
      meta: previewCount ? `${previewCount} rows` : "No preview yet",
    },
    {
      key: "analysis",
      label: "Analysis",
      meta: "Variance drivers",
    },
  ];

  return (
    <section className="rounded-3xl border border-slate-200 bg-[#fcfcfa] p-3">
      <div className="grid gap-3 md:grid-cols-3">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={`rounded-2xl border px-4 py-4 text-left transition ${
                isActive
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
              }`}
            >
              <div className="text-sm font-semibold">{tab.label}</div>
              <div className={`mt-1 text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>
                {tab.meta}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ImportStudio() {
  const [activePeriod, setActivePeriod] = useState<PeriodKey>("current");
  const [sessions, setSessions] = useState<Record<PeriodKey, SessionCard>>(INITIAL_SESSIONS);
  const [reusableTemplates, setReusableTemplates] = useState<ReusableTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"mapping" | "preview" | "analysis">("mapping");

  useEffect(() => {
    const raw = window.localStorage.getItem(REUSABLE_TEMPLATE_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as ReusableTemplate[];
      setReusableTemplates(Array.isArray(parsed) ? parsed : []);
    } catch {
      setReusableTemplates([]);
    }
  }, []);

  function addManualExpenseLine(period: PeriodKey) {
    setSessions((prev) => ({
      ...prev,
      [period]: {
        ...prev[period],
        manualExpenses: [
          ...(prev[period].manualExpenses ?? []),
          { id: crypto.randomUUID(), description: "", amount: 0 },
        ],
      },
    }));
  }

  function updateManualExpenseLine(
    period: PeriodKey,
    id: string,
    patch: Partial<ManualExpenseLine>,
  ) {
    setSessions((prev) => ({
      ...prev,
      [period]: {
        ...prev[period],
        manualExpenses: (prev[period].manualExpenses ?? []).map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      },
    }));
  }

  function removeManualExpenseLine(period: PeriodKey, id: string) {
    setSessions((prev) => ({
      ...prev,
      [period]: {
        ...prev[period],
        manualExpenses: (prev[period].manualExpenses ?? []).filter((item) => item.id !== id),
      },
    }));
  }

  const activeSession = useMemo(() => sessions[activePeriod], [sessions, activePeriod]);
  const activeDerivedTable = useMemo(
    () => getDerivedTable(activeSession.rows, activeSession.headerRowIndex),
    [activeSession.rows, activeSession.headerRowIndex],
  );
  const compatibleTemplates = useMemo(
    () =>
      reusableTemplates.filter(
        (item) =>
          item.sourceSystem === activeSession.sourceSystem &&
          item.fileType === activeSession.fileType,
      ),
    [reusableTemplates, activeSession.sourceSystem, activeSession.fileType],
  );

  useEffect(() => {
    if (!compatibleTemplates.length) {
      setSelectedTemplateId("");
      return;
    }

    setSelectedTemplateId((current) =>
      current && compatibleTemplates.some((item) => item.id === current)
        ? current
        : compatibleTemplates[0]!.id,
    );
  }, [compatibleTemplates]);

  function saveTemplates(nextTemplates: ReusableTemplate[]) {
    setReusableTemplates(nextTemplates);
    window.localStorage.setItem(REUSABLE_TEMPLATE_STORAGE_KEY, JSON.stringify(nextTemplates));
  }

  function persistTemplateFromSession(session: SessionCard) {
    if (!session.templateSignature || session.headerRowIndex === null || !session.mappings.length) return;

    const template: ReusableTemplate = {
      id: reusableTemplates.find((item) => item.signature === session.template === session.templateSignature)?.id ?? crypto.randomUUID(),
      signature: session.templateSignature,
      name: session.templateName.trim() || `${session.sourceSystem} ${session.fileType}`,
      sourceSystem: session.sourceSystem,
      fileType: session.fileType,
      headerRowIndex: session.headerRowIndex,
      mappings: session.mappings,
      updatedAt: new Date().toISOString(),
    };

    const existing = reusableTemplates.find((item) => item.signature === template.signature);
    const nextTemplates = existing
      ? reusableTemplates.map((item) => (item.signature === template.signature ? template : item))
      : [template, ...reusableTemplates];

    saveTemplates(nextTemplates);
  }

  function buildMappedSession(baseSession: SessionCard, headerRowIndex: number) {
    const derived = getDerivedTable(baseSession.rows, headerRowIndex);
    const templateSignature = getTemplateSignature(
      baseSession.sourceSystem,
      baseSession.fileType,
      derived.header,
    );

    const matchedTemplate = reusableTemplates.find((item) => item.signature === templateSignature);
    const baseMappings = buildMappings(baseSession.rows, headerRowIndex);
    const mappings = applyTemplateMappings(baseMappings, matchedTemplate);

    return {
      ...baseSession,
      headerRowIndex,
      templateSignature,
      matchedReusableTemplateId: matchedTemplate?.id ?? null,
      templateName: matchedTemplate?.name ?? baseSession.templateName ?? "",
      mappings,
    };
  }

  function replaceSession(period: PeriodKey, nextSession: SessionCard) {
    setSessions((current) => ({
      ...current,
      [period]: nextSession,
    }));
  }

  async function handleFilePick(period: PeriodKey, file: File | null) {
    if (!file) return;

    setActivePeriod(period);
    replaceSession(period, {
      ...sessions[period],
      fileName: file.name,
      isParsing: true,
      parseError: null,
      rows: [],
      detectedHeaderRowIndex: null,
      likelyHeaderRows: [],
      headerRowIndex: null,
      mappings: [],
      templateSignature: null,
      matchedReusableTemplateId: null,
      templateName: "",
    });

    const result = await parseCsvFile(file);
    const detectedHeaderRowIndex = result.rows.length ? detectBestHeaderRow(result.rows) : null;
    const likelyHeaderRows = rankLikelyHeaderRows(result.rows);

    const parsedSession: SessionCard = {
      ...sessions[period],
      fileName: file.name,
      isParsing: false,
      parseError: result.parseError,
      rows: result.rows,
      detectedHeaderRowIndex,
      likelyHeaderRows,
      headerRowIndex: null,
      mappings: [],
      templateSignature: null,
      matchedReusableTemplateId: null,
    };

    const mappedSession =
      detectedHeaderRowIndex === null
        ? parsedSession
        : buildMappedSession(parsedSession, detectedHeaderRowIndex);

    replaceSession(period, mappedSession);
    persistTemplateFromSession(mappedSession);
  }

  function handleHeaderRowChange(period: PeriodKey, rowIndex: number) {
    const session = sessions[period];
    if (!session.rows[rowIndex]) return;

    const nextSession = buildMappedSession(session, rowIndex);
    replaceSession(period, nextSession);
    persistTemplateFromSession(nextSession);
  }

  function handleSessionMetaChange(period: PeriodKey, patch: Partial<SessionCard>) {
    const session = sessions[period];
    let nextSession: SessionCard = { ...session, ...patch };

    if (nextSession.rows.length && nextSession.headerRowIndex !== null) {
      nextSession = buildMappedSession(nextSession, nextSession.headerRowIndex);
    }

    replaceSession(period, nextSession);
    persistTemplateFromSession(nextSession);
  }

  function updateMapping(period: PeriodKey, columnIndex: number, updater: (mapping: MappingItem) => MappingItem) {
    const session = sessions[period];
    const nextSession: SessionCard = {
      ...session,
      mappings: session.mappings.map((mapping) =>
        mapping.columnIndex === columnIndex ? updater(mapping) : mapping,
      ),
    };

    replaceSession(period, nextSession);
    persistTemplateFromSession(nextSession);
  }

  function setMappingField(period: PeriodKey, columnIndex: number, fieldKey: string) {
    updateMapping(period, columnIndex, (mapping) => {
      if (fieldKey === "__CUSTOM__") {
        return {
          ...mapping,
          normalizedFieldKey: `custom:${mapping.customValue || mapping.originalHeader}`,
          normalizedFieldLabel: mapping.customValue || mapping.originalHeader,
          status: "Custom",
          ignored: false,
        };
      }

      const selectedField = NORMALIZED_FIELDS.find((field) => field.key === fieldKey);

      return {
        ...mapping,
        normalizedFieldKey: selectedField?.key ?? "",
        normalizedFieldLabel: selectedField?.label ?? "",
        status: selectedField ? "Confirmed" : "Suggested",
        ignored: false,
      };
    });
  }

  function saveActiveSessionTemplate() {
    persistTemplateFromSession(activeSession);
  }

  function applyReusableTemplate(period: PeriodKey, templateId: string) {
    const session = sessions[period];
    const template = reusableTemplates.find((item) => item.id === templateId);

    if (!template || session.headerRowIndex === null || !session.rows.length) return;

    const baseMappings = buildMappings(session.rows, session.headerRowIndex);
    const nextSession: SessionCard = {
      ...session,
      mappings: applyTemplateMappings(baseMappings, template),
      matchedReusableTemplateId: template.id,
    };

    replaceSession(period, nextSession);
    persistTemplateFromSession(nextSession);
  }

  function copyMappingsFromOtherPeriod(targetPeriod: PeriodKey) {
    const sourcePeriod: PeriodKey = targetPeriod === "current" ? "previous" : "current";
    const sourceSession = sessions[sourcePeriod];
    const targetSession = sessions[targetPeriod];

    if (!sourceSession.mappings.length || targetSession.headerRowIndex === null || !targetSession.rows.length) {
      return;
    }

    const adHocTemplate: ReusableTemplate = {
      id: sourceSession.matchedReusableTemplateId ?? `ad-hoc-${sourcePeriod}`,
      signature: sourceSession.templateSignature ?? `ad-hoc-${sourcePeriod}`,
      name: `${sourceSession.label} mapping`,
      sourceSystem: sourceSession.sourceSystem,
      fileType: sourceSession.fileType,
      headerRowIndex: sourceSession.headerRowIndex ?? 0,
      mappings: sourceSession.mappings,
      updatedAt: new Date().toISOString(),
    };

    const baseMappings = buildMappings(targetSession.rows, targetSession.headerRowIndex);
    const nextSession: SessionCard = {
      ...targetSession,
      mappings: applyTemplateMappings(baseMappings, adHocTemplate),
      matchedReusableTemplateId: targetSession.matchedReusableTemplateId,
    };

    replaceSession(targetPeriod, nextSession);
    persistTemplateFromSession(nextSession);
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Equity Close OS</p>
                <h1 className="mt-2 text-4xl font-semibold tracking-tight">Import Studio</h1>
                <p className="mt-3 max-w-3xl text-sm text-slate-600">
                  Compact header control, real mapping workflow, saved templates, and a first period-vs-period analysis block.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Active session: <span className="font-semibold text-slate-900">{activeSession.label}</span>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
              <SessionPanel
                session={sessions.current}
                isActive={activePeriod === "current"}
                onActivate={() => setActivePeriod("current")}
                onFilePick={(file) => void handleFilePick("current", file)}
                onSourceChange={(value) => handleSessionMetaChange("current", { sourceSystem: value })}
                onFileTypeChange={(value) => handleSessionMetaChange("current", { fileType: value })}
              />

              <SessionPanel
                session={sessions.previous}
                isActive={activePeriod === "previous"}
                onActivate={() => setActivePeriod("previous")}
                onFilePick={(file) => void handleFilePick("previous", file)}
                onSourceChange={(value) => handleSessionMetaChange("previous", { sourceSystem: value })}
                onFileTypeChange={(value) => handleSessionMetaChange("previous", { fileType: value })}
              />

              <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                      

<p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Workspace summary</p>
                <h2 className="mt-2 text-xl font-semibold">Status</h2>

                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-sm text-slate-500">Current template reuse</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {sessions.current.matchedReusableTemplateId ? "Template matched or applied" : "No reusable match yet"}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-sm text-slate-500">Previous template reuse</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {sessions.previous.matchedReusableTemplateId ? "Template matched or applied" : "No reusable match yet"}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white p-4">
                    

<p className="text-sm text-slate-500">Selected header row</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {activeSession.headerRowIndex === null ? "—" : `Row ${activeSession.headerRowIndex + 1}`}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-sm text-slate-500">Data rows after header</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{activeDerivedTable.dataRowCount}</p>
                  </div>
                </div>
              </section>
            </div>

            <HeaderControlBar
              session={activeSession}
              onUseDetected={() => {
                if (activeSession.detectedHeaderRowIndex !== null) {
                  handleHeaderRowChange(activePeriod, activeSession.detectedHeaderRowIndex);
                }
              }}
              onHeaderRowChange={(index) => handleHeaderRowChange(activePeriod, index)}
            />

            <TemplateActionBar
              session={activeSession}
              compatibleTemplates={compatibleTemplates}
              selectedTemplateId={selectedTemplateId}
              onSelectedTemplateIdChange={setSelectedTemplateId}
              onTemplateNameChange={(value) =>
                handleSessionMetaChange(activePeriod, { templateName: value })
              }
              onSaveActiveTemplate={saveActiveSessionTemplate}
              onApplySelectedTemplate={() => applyReusableTemplate(activePeriod, selectedTemplateId)}
              copyLabel={activePeriod === "current" ? "Copy mapping from previous file" : "Copy mapping from current file"}
              onCopyFromOtherPeriod={() => copyMappingsFromOtherPeriod(activePeriod)}
            />

            <WorkspaceTabs
              activeTab={activeWorkspaceTab}
              onChange={setActiveWorkspaceTab}
              mappingCount={activeSession.mappings.length}
              previewCount={activeDerivedTable.dataRowCount}
            />

            {activeWorkspaceTab === "mapping" ? (
              <section className="rounded-3xl border border-slate-200 bg-[#fcfcfa] p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Mapping studio</p>
                    <h2 className="mt-2 text-2xl font-semibold">{activeSession.label}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Confirm, ignore, or customize each header. Changes are saved for the same template.
                    </p>
                  </div>

                  <div className="text-sm text-slate-500">
                    {activeSession.fileName ?? "No file selected"}
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  Smart template reuse now tries exact header match first, then similar header names, then likely normalized field meaning, and finally column position as a last fallback.
                </div>

                <div className="mt-5">
                  <MappingGrid
                    session={activeSession}
                    onSetField={(columnIndex, fieldKey) => setMappingField(activePeriod, columnIndex, fieldKey)}
                    onConfirm={(columnIndex) =>
                      updateMapping(activePeriod, columnIndex, (mapping) => ({
                        ...mapping,
                        status: "Confirmed",
                        ignored: false,
                      }))
                    }
                    onIgnore={(columnIndex) =>
                      updateMapping(activePeriod, columnIndex, (mapping) => ({
                        ...mapping,
                        status: "Ignored",
                        ignored: true,
                      }))
                    }
                    onCustom={(columnIndex) =>
                      updateMapping(activePeriod, columnIndex, (mapping) => ({
                        ...mapping,
                        status: "Custom",
                        ignored: false,
                        customValue: mapping.customValue || mapping.originalHeader,
                        normalizedFieldKey: `custom:${mapping.customValue || mapping.originalHeader}`,
                        normalizedFieldLabel: mapping.customValue || mapping.originalHeader,
                      }))
                    }
                    onCustomValueChange={(columnIndex, value) =>
                      updateMapping(activePeriod, columnIndex, (mapping) => ({
                        ...mapping,
                        customValue: value,
                        normalizedFieldKey: `custom:${value || mapping.originalHeader}`,
                        normalizedFieldLabel: value || mapping.originalHeader,
                        status: "Custom",
                        ignored: false,
                      }))
                    }
                  />
                </div>
              </section>
            ) : null}

            {activeWorkspaceTab === "preview" ? (
              <section className="rounded-3xl border border-slate-200 bg-[#fcfcfa] p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">File preview</p>
                    <h2 className="mt-2 text-2xl font-semibold">{activeSession.label}</h2>
                    <p className="mt-1 text-sm text-slate-600">Preview based on the selected header row.</p>
                  </div>

                  <div className="text-sm text-slate-500">
                    {activeSession.fileName ?? "No file selected"}
                  </div>
                </div>

                <div className="mt-5">
                  <PreviewTable rows={activeSession.rows} headerRowIndex={activeSession.headerRowIndex} />
                </div>
              </section>
            ) : null}

            {activeWorkspaceTab === "analysis" ? (
              <PeriodAnalysis
                currentSession={sessions.current}
                previousSession={sessions.previous}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export default ImportStudio;
