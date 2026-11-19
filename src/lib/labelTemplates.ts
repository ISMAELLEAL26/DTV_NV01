import { createDefaultLabelLayout, type LabelLayout } from '@/lib/labelPrint';

export interface LabelTemplate {
  id: string;
  name: string;
  layout: LabelLayout;
  builtin?: boolean;
}

export const LABEL_PRINTER_STORAGE_KEY = 'pos_label_printer_name';
export const LABEL_LOGO_STORAGE_KEY = 'pos_label_logo_data_url';

const TEMPLATES_KEY = 'pos_label_templates_v1';

export function defaultLabelTemplates(): LabelTemplate[] {
  return [
    { id: 'builtin-standard-37x30', name: 'Estándar 37.5 × 30 mm', layout: createDefaultLabelLayout(), builtin: true },
  ];
}

export function loadLabelTemplates(): LabelTemplate[] {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LabelTemplate[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => !!t && typeof t.id === 'string' && !!t.layout && Array.isArray(t.layout.elements));
  } catch {
    return [];
  }
}

export function saveLabelTemplates(templates: LabelTemplate[]): void {
  try {
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    // localStorage may be unavailable in private windows; selection is best effort
  }
}
