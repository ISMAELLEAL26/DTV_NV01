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

function createCleanPriceLayout(): LabelLayout {
  const base = createDefaultLabelLayout();
  return {
    ...base,
    elements: base.elements.map((el) => {
      if (el.id === 'product') return { ...el, y: 1.5, height: 8.5, fontSize: 8.5 };
      if (el.id === 'price') return { ...el, y: 10.5, height: 11.5, fontSize: 18 };
      if (el.id === 'qr' || el.id === 'qr-code' || el.id === 'right-code' || el.id === 'department' || el.id === 'logo') {
        return { ...el, visible: false };
      }
      return el;
    }),
  };
}

export function defaultLabelTemplates(): LabelTemplate[] {
  return [
    {
      id: 'builtin-standard-37x30',
      name: 'Estándar 37.5 × 30 mm (Sin logo)',
      layout: createDefaultLabelLayout(),
      builtin: true,
    },
    {
      id: 'builtin-clean-price-37x30',
      name: 'Solo Nombre y Precio 37.5 × 30 mm',
      layout: createCleanPriceLayout(),
      builtin: true,
    },
  ];
}

export function loadLabelTemplates(): LabelTemplate[] {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LabelTemplate[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) =>
        !!t &&
        typeof t.id === 'string' &&
        !t.id.startsWith('builtin-') &&
        !!t.layout &&
        Array.isArray(t.layout.elements)
    );
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
