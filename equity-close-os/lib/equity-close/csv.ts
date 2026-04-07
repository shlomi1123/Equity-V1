import Papa from "papaparse";
import { NORMALIZED_FIELDS } from "@/lib/equity-close/constants";
import type {
  Confidence,
  DetectionResult,
  MappingDecision,
  ParsedCsvData,
} from "@/lib/equity-close/types";

export function parseCsvFile(file: File): Promise<ParsedCsvData> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: false,
      complete: (results) => {
        const rows = (results.data ?? []).map((row) =>
          Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : [],
        );

        const maxColumnCount = rows.reduce(
          (max, row) => Math.max(max, row.length),
          0,
        );

        resolve({
          rows,
          maxColumnCount,
        });
      },
      error: (error) => reject(error),
    });
  });
}

export function normalizeHeaderText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getRowPreview(row: string[], maxColumns: number): string[] {
  return Array.from({ length: maxColumns }, (_, index) => row[index] ?? "");
}

function scoreHeaderCandidateRow(row: string[]): number {
  const nonEmpty = row
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

  if (!nonEmpty.length) return -1000;

  const normalized = nonEmpty.map(normalizeHeaderText);

  const textLikeCount = nonEmpty.filter((cell) => /[a-zA-Z]/.test(cell)).length;
  const numericLikeCount = nonEmpty.filter((cell) =>
    /^-?\d+([.,]\d+)?$/.test(cell.trim()),
  ).length;
  const veryLongCount = nonEmpty.filter((cell) => cell.length > 40).length;
  const duplicatePenalty = nonEmpty.length - new Set(normalized).size;

  const synonymMatches = normalized.reduce((count, headerCell) => {
    const hasMatch = NORMALIZED_FIELDS.some((field) =>
      field.synonyms.some((synonym) =>
        headerCell.includes(normalizeHeaderText(synonym)),
      ),
    );

    return count + (hasMatch ? 1 : 0);
  }, 0);

  const commonHeaderSignals = normalized.filter((cell) =>
    [
      "employee",
      "name",
      "grant",
      "award",
      "date",
      "expense",
      "department",
      "cost center",
      "entity",
      "country",
      "id",
      "type",
    ].some((signal) => cell.includes(signal)),
  ).length;

  return (
    nonEmpty.length * 2 +
    textLikeCount * 2 +
    synonymMatches * 5 +
    commonHeaderSignals * 3 -
    numericLikeCount * 4 -
    veryLongCount * 2 -
    duplicatePenalty * 3
  );
}

export function suggestHeaderRow(rows: string[][]): number {
  const searchDepth = Math.min(rows.length, 75);

  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let index = 0; index < searchDepth; index += 1) {
    const row = rows[index] ?? [];
    const score = scoreHeaderCandidateRow(row);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function detectSourceSystem(headers: string[]): DetectionResult {
  const normalized = headers.map(normalizeHeaderText);

  const etradeSignals = [
    "grant number",
    "award type",
    "grant date",
    "vest date",
    "participant",
  ];

  const cartaSignals = [
    "holder name",
    "security type",
    "vesting schedule",
    "exercise price",
    "issue date",
  ];

  const etradeMatches = etradeSignals.filter((signal) =>
    normalized.some((header) => header.includes(signal)),
  );

  const cartaMatches = cartaSignals.filter((signal) =>
    normalized.some((header) => header.includes(signal)),
  );

  if (etradeMatches.length >= 2 && etradeMatches.length > cartaMatches.length) {
    return {
      sourceSystem: "ETRADE",
      confidence: etradeMatches.length >= 3 ? "High" : "Medium",
      matchedSignals: etradeMatches,
    };
  }

  if (cartaMatches.length >= 2 && cartaMatches.length > etradeMatches.length) {
    return {
      sourceSystem: "CARTA",
      confidence: cartaMatches.length >= 3 ? "High" : "Medium",
      matchedSignals: cartaMatches,
    };
  }

  return {
    sourceSystem: "GENERIC",
    confidence: "Low",
    matchedSignals: [],
  };
}

function inferConfidence(
  sourceColumn: string,
  normalizedFieldLabel: string | null,
): Confidence | null {
  if (!normalizedFieldLabel) return null;

  const source = normalizeHeaderText(sourceColumn);
  const target = normalizeHeaderText(normalizedFieldLabel);

  if (source === target) return "High";
  if (source.includes(target) || target.includes(source)) return "Medium";
  return "Low";
}

export function buildInitialMappings(
  headers: string[],
  sampleRows: string[][],
): MappingDecision[] {
  return headers.map((header, columnIndex) => {
    const normalizedHeader = normalizeHeaderText(header);

    const matchedField =
      NORMALIZED_FIELDS.find((field) =>
        field.synonyms.some((synonym) =>
          normalizedHeader.includes(normalizeHeaderText(synonym)),
        ),
      ) ?? null;

    const sampleValues = sampleRows
      .slice(0, 3)
      .map((row) => row[columnIndex] ?? "")
      .filter(Boolean);

    if (!matchedField) {
      return {
        sourceColumn: header || `Column ${columnIndex + 1}`,
        normalizedFieldKey: null,
        normalizedFieldLabel: null,
        status: "Unmapped",
        confidence: null,
        ignored: false,
        sampleValues,
      };
    }

    return {
      sourceColumn: header || `Column ${columnIndex + 1}`,
      normalizedFieldKey: matchedField.key,
      normalizedFieldLabel: matchedField.label,
      status: "Suggested",
      confidence: inferConfidence(header, matchedField.label),
      ignored: false,
      sampleValues,
    };
  });
}
