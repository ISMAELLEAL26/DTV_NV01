import { supabase } from '@/lib/supabase';
import type { Branch, Product, ProductBranchPrice } from '@/lib/types';

export type ProductPriceFields = Pick<Product, 'cost_price' | 'sale_price' | 'price_2' | 'price_3'>;
export type BranchPriceField = keyof ProductPriceFields;
export type BranchPriceInput = Partial<Record<BranchPriceField, number>>;
export type BranchPriceDraft = Record<BranchPriceField, string>;

export const BRANCH_PRICE_FIELDS: { field: BranchPriceField; label: string; header: string }[] = [
  { field: 'cost_price', label: 'Precio de costo', header: 'Costo' },
  { field: 'sale_price', label: 'Precio de venta 1', header: 'Venta 1' },
  { field: 'price_2', label: 'Precio de venta 2', header: 'Venta 2' },
  { field: 'price_3', label: 'Precio de venta 3', header: 'Venta 3' },
];

export function branchPriceHeaders(branch: Branch): string[] {
  return BRANCH_PRICE_FIELDS.map((f) => `${f.header} ${branch.name}`);
}

export function effectivePrices(product: ProductPriceFields & { prices_shared: boolean }, branchRow: ProductBranchPrice | undefined): ProductPriceFields {
  if (product.prices_shared || !branchRow) {
    return { cost_price: product.cost_price, sale_price: product.sale_price, price_2: product.price_2, price_3: product.price_3 };
  }
  return {
    cost_price: Number(branchRow.cost_price),
    sale_price: Number(branchRow.sale_price),
    price_2: Number(branchRow.price_2),
    price_3: Number(branchRow.price_3),
  };
}

export function computeMarginPercent(cost: number, sale: number, taxRate: number, iepsRate: number): number {
  if (cost <= 0) return 0;
  const totalTaxRate = taxRate + iepsRate;
  const priceWithoutTax = totalTaxRate > 0 ? sale / (1 + totalTaxRate / 100) : sale;
  return ((priceWithoutTax - cost) / cost) * 100;
}

export function draftFromPrices(prices: ProductPriceFields): BranchPriceDraft {
  return {
    cost_price: String(prices.cost_price),
    sale_price: String(prices.sale_price),
    price_2: String(prices.price_2),
    price_3: String(prices.price_3),
  };
}

export function draftToInput(draft: BranchPriceDraft): BranchPriceInput {
  const parse = (v: string) => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    cost_price: parse(draft.cost_price),
    sale_price: parse(draft.sale_price),
    price_2: parse(draft.price_2),
    price_3: parse(draft.price_3),
  };
}

export function hasNegativePrice(input: BranchPriceInput): boolean {
  return BRANCH_PRICE_FIELDS.some((f) => (input[f.field] ?? 0) < 0);
}

export interface BranchPriceRowPayload extends ProductPriceFields {
  product_id: string;
  branch_id: string;
}

export function buildBranchPriceRows(
  productId: string,
  branchIds: string[],
  shared: ProductPriceFields,
  existingRows: ProductBranchPrice[],
  inputs: Record<string, BranchPriceInput>,
): BranchPriceRowPayload[] {
  return branchIds.map((branchId) => {
    const existing = existingRows.find((r) => r.branch_id === branchId);
    const base = existing ? effectivePrices({ ...shared, prices_shared: false }, existing) : shared;
    const input = inputs[branchId] ?? {};
    return {
      product_id: productId,
      branch_id: branchId,
      cost_price: input.cost_price ?? base.cost_price,
      sale_price: input.sale_price ?? base.sale_price,
      price_2: input.price_2 ?? base.price_2,
      price_3: input.price_3 ?? base.price_3,
    };
  });
}

export async function upsertBranchPriceRows(rows: BranchPriceRowPayload[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const { error } = await supabase.from('product_branch_prices').upsert(rows, { onConflict: 'product_id,branch_id' });
  if (error) console.error('branch price upsert failed', error);
  return !error;
}

export async function saveProductPrices(
  product: Pick<Product, 'id' | 'prices_shared'>,
  branchId: string,
  prices: ProductPriceFields,
): Promise<boolean> {
  if (product.prices_shared) {
    const { error } = await supabase.from('products').update(prices).eq('id', product.id);
    if (error) console.error('product price update failed', error);
    return !error;
  }
  return upsertBranchPriceRows([{ product_id: product.id, branch_id: branchId, ...prices }]);
}

export async function fetchAllBranchPrices(): Promise<ProductBranchPrice[]> {
  const all: ProductBranchPrice[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('product_branch_prices').select('*').range(from, from + 999);
    if (error) { console.error(error); break; }
    all.push(...((data as ProductBranchPrice[]) ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return all;
}
