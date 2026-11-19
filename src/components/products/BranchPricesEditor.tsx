import type { Branch } from '@/lib/types';
import { BRANCH_PRICE_FIELDS, computeMarginPercent, draftToInput, type BranchPriceDraft, type BranchPriceField } from '@/lib/branchPrices';
import { Field, Input } from '@/components/Field';

interface BranchPricesEditorProps {
  branches: Branch[];
  drafts: Record<string, BranchPriceDraft>;
  taxRate: number;
  iepsRate: number;
  onChange: (branchId: string, field: BranchPriceField, value: string) => void;
}

export default function BranchPricesEditor({ branches, drafts, taxRate, iepsRate, onChange }: BranchPricesEditorProps) {
  return (
    <div className="space-y-3">
      {branches.map((b) => {
        const draft = drafts[b.id];
        if (!draft) return null;
        const input = draftToInput(draft);
        const margin = computeMarginPercent(input.cost_price ?? 0, input.sale_price ?? 0, taxRate, iepsRate);
        return (
          <div key={b.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{b.name}</span>
              <span className={`rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold ${margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                Margen {margin.toFixed(1)}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {BRANCH_PRICE_FIELDS.map((f) => (
                <Field key={f.field} label={f.label}>
                  <Input
                    type="number"
                    step="0.01"
                    value={draft[f.field]}
                    onChange={(e) => onChange(b.id, f.field, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
