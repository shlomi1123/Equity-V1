import { getRowPreview, normalizeHeaderText } from "@/lib/equity-close/csv";
import type {
  MappingDecision,
  ParsedCsvData,
  ReusableTemplate,
  TemplateMappingSetting,
} from "@/lib/equity-close/types";

export function buildTemplateSignature(headers: string[]): string {
  return headers.map((header) => normalizeHeaderText(header)).join("||");
}

export function extractTemplateMappingSettings(
  mappings: MappingDecision[],
): TemplateMappingSetting[] {
  return mappings.map((mapping) => ({
    normalizedFieldKey: mapping.normalizedFieldKey,
    normalizedFieldLabel: mapping.normalizedFieldLabel,
    status: mapping.status,
    confidence: mapping.confidence,
    ignored: mapping.ignored,
  }));
}

export function applyTemplateMappingSettings(
  baseMappings: MappingDecision[],
  settings: TemplateMappingSetting[],
): MappingDecision[] {
  return baseMappings.map((baseMapping, index) => {
    const setting = settings[index];
    if (!setting) return baseMapping;

    return {
      ...baseMapping,
      normalizedFieldKey: setting.normalizedFieldKey,
      normalizedFieldLabel: setting.normalizedFieldLabel,
      status: setting.status,
      confidence: setting.confidence,
      ignored: setting.ignored,
    };
  });
}

export function findMatchingReusableTemplate(
  parsedCsv: ParsedCsvData,
  templates: ReusableTemplate[],
): { template: ReusableTemplate; headerRowIndex: number; signature: string } | null {
  if (!templates.length) return null;

  const templateMap = new Map<string, ReusableTemplate>();
  templates.forEach((template) => {
    templateMap.set(template.signature, template);
  });

  const searchDepth = Math.min(parsedCsv.rows.length, 75);

  for (let rowIndex = 0; rowIndex < searchDepth; rowIndex += 1) {
    const headers = getRowPreview(
      parsedCsv.rows[rowIndex] ?? [],
      parsedCsv.maxColumnCount,
    ).map((value, index) => value || `Column ${index + 1}`);

    const hasAnyValue = headers.some((header) => String(header).trim().length > 0);
    if (!hasAnyValue) continue;

    const signature = buildTemplateSignature(headers);
    const matchedTemplate = templateMap.get(signature);

    if (matchedTemplate) {
      return {
        template: matchedTemplate,
        headerRowIndex: rowIndex,
        signature,
      };
    }
  }

  return null;
}
