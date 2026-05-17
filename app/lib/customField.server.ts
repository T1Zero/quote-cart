import type { CustomField } from "@prisma/client";
import prisma from "../db.server";

export type FieldType = "text" | "textarea" | "email" | "tel" | "select";

export type IncomingField = {
  id?: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  placeholder?: string;
  required: boolean;
  position: number;
};

export type FieldDescriptor = {
  id: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  placeholder: string;
  required: boolean;
  position: number;
  labelTranslations: Record<string, string>;
  placeholderTranslations: Record<string, string>;
  optionsTranslations: Record<string, string[]>;
};

/**
 * Pick the right label / placeholder / options for the active storefront language.
 * Falls back to the default (English) value when there's no translation.
 */
export function localizeField(field: FieldDescriptor, lang: string): {
  label: string;
  placeholder: string;
  options: string[];
} {
  const code = (lang || "").toLowerCase().slice(0, 2);
  const label = field.labelTranslations[code] || field.label;
  const placeholder = field.placeholderTranslations[code] || field.placeholder;
  const translatedOptions = field.optionsTranslations[code];
  const options =
    Array.isArray(translatedOptions) && translatedOptions.length === field.options.length
      ? translatedOptions
      : field.options;
  return { label, placeholder, options };
}

const VALID_TYPES: FieldType[] = ["text", "textarea", "email", "tel", "select"];

export async function listCustomFields(shopDomain: string): Promise<FieldDescriptor[]> {
  const rows = await prisma.customField.findMany({
    where: { shopDomain },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDescriptor);
}

function toDescriptor(row: CustomField): FieldDescriptor {
  let options: string[] = [];
  if (row.fieldType === "select" && row.options) {
    try {
      const parsed = JSON.parse(row.options);
      if (Array.isArray(parsed)) options = parsed.filter((s) => typeof s === "string");
    } catch {
      /* ignore */
    }
  }
  return {
    id: row.id,
    label: row.label,
    fieldType: (VALID_TYPES.includes(row.fieldType as FieldType)
      ? row.fieldType
      : "text") as FieldType,
    options,
    placeholder: row.placeholder,
    required: row.required,
    position: row.position,
    labelTranslations: parseStringMap(row.labelTranslations),
    placeholderTranslations: parseStringMap(row.placeholderTranslations),
    optionsTranslations: parseOptionsMap(row.optionsTranslations),
  };
}

function parseStringMap(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k.toLowerCase()] = v;
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function parseOptionsMap(raw: string): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) {
          out[k.toLowerCase()] = v.filter((s): s is string => typeof s === "string");
        }
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export type SaveFieldInput = {
  id?: string | null;
  label: string;
  fieldType: string;
  optionsRaw: string; // newline- or comma-separated
  placeholder: string;
  required: boolean;
  position: number;
  // Translations — keys are 2-letter language codes (e.g., "bg"). Empty values are ignored.
  labelTranslations?: Record<string, string>;
  placeholderTranslations?: Record<string, string>;
  optionsRawTranslations?: Record<string, string>;
};

export function parseOptionsRaw(raw: string): string[] {
  return raw
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function upsertCustomField(
  shopDomain: string,
  input: SaveFieldInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Label is required." };
  const fieldType = (VALID_TYPES.includes(input.fieldType as FieldType)
    ? input.fieldType
    : "text") as FieldType;
  const optionsArr =
    fieldType === "select" ? parseOptionsRaw(input.optionsRaw) : [];
  if (fieldType === "select" && optionsArr.length === 0) {
    return { ok: false, error: "Dropdown fields need at least one option." };
  }

  const labelTranslations = filterStringMap(input.labelTranslations);
  const placeholderTranslations = filterStringMap(input.placeholderTranslations);

  // optionsRawTranslations is provided as { "bg": "Опция 1\nОпция 2" }.
  // Parse each into a string[] and only persist if the parsed count matches
  // the default options count (so they line up positionally).
  const optionsTranslationsParsed: Record<string, string[]> = {};
  if (fieldType === "select" && input.optionsRawTranslations) {
    for (const [code, raw] of Object.entries(input.optionsRawTranslations)) {
      const arr = parseOptionsRaw(raw);
      if (arr.length === optionsArr.length && arr.length > 0) {
        optionsTranslationsParsed[code.toLowerCase()] = arr;
      }
    }
  }

  const data = {
    label,
    fieldType,
    options: JSON.stringify(optionsArr),
    placeholder: (input.placeholder || "").trim(),
    required: input.required,
    position: Math.max(0, Math.floor(input.position)),
    labelTranslations: JSON.stringify(labelTranslations),
    placeholderTranslations: JSON.stringify(placeholderTranslations),
    optionsTranslations: JSON.stringify(optionsTranslationsParsed),
  };

  if (input.id) {
    const existing = await prisma.customField.findFirst({
      where: { id: input.id, shopDomain },
    });
    if (!existing) return { ok: false, error: "Field not found." };
    const updated = await prisma.customField.update({
      where: { id: input.id },
      data,
    });
    return { ok: true, id: updated.id };
  }

  const created = await prisma.customField.create({
    data: { shopDomain, ...data },
  });
  return { ok: true, id: created.id };
}

function filterStringMap(input?: Record<string, string>): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.trim()) {
      out[k.toLowerCase().slice(0, 2)] = v.trim();
    }
  }
  return out;
}

export async function deleteCustomField(shopDomain: string, id: string) {
  await prisma.customField.deleteMany({ where: { id, shopDomain } });
}

export async function reorderCustomFields(
  shopDomain: string,
  orderedIds: string[],
) {
  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.customField.updateMany({
        where: { id, shopDomain },
        data: { position: idx },
      }),
    ),
  );
}

/**
 * Validates submitted values against the field config.
 * Returns an array of {fieldId, label, value} ready to persist.
 */
export function validateAndCollectValues(
  fields: FieldDescriptor[],
  raw: Record<string, string>,
): { ok: true; values: { fieldId: string; label: string; value: string }[] } | {
  ok: false;
  errors: { field: string; message: string }[];
} {
  const errors: { field: string; message: string }[] = [];
  const values: { fieldId: string; label: string; value: string }[] = [];

  for (const f of fields) {
    const v = (raw[f.id] || "").trim();
    if (f.required && !v) {
      errors.push({ field: f.id, message: `${f.label} is required.` });
      continue;
    }
    if (v && f.fieldType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      errors.push({ field: f.id, message: `${f.label} must be a valid email.` });
      continue;
    }
    if (v && f.fieldType === "select" && f.options.length > 0 && !f.options.includes(v)) {
      errors.push({ field: f.id, message: `${f.label} has an invalid option.` });
      continue;
    }
    values.push({ fieldId: f.id, label: f.label, value: v });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, values };
}

export async function saveValuesForQuote(
  quoteId: string,
  values: { fieldId: string; label: string; value: string }[],
) {
  if (!values.length) return;
  await prisma.customFieldValue.createMany({
    data: values.map((v) => ({
      quoteId,
      fieldId: v.fieldId,
      fieldLabel: v.label,
      fieldValue: v.value,
    })),
  });
}

export async function getValuesForQuote(quoteId: string) {
  return prisma.customFieldValue.findMany({
    where: { quoteId },
    orderBy: { id: "asc" },
  });
}
