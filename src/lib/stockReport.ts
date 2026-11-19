import { supabase } from '@/lib/supabase';
import type { Category, Department, Location, Product, ProductStock } from '@/lib/types';

export type StockReportProduct = Pick<Product, 'id' | 'name' | 'sku' | 'department' | 'category_id' | 'cost_price' | 'sale_price' | 'is_package'>;
export type StockReportRow = Pick<ProductStock, 'product_id' | 'branch_id' | 'location_id' | 'quantity'>;

export interface StockReportData {
  products: StockReportProduct[];
  stockRows: StockReportRow[];
}

export async function fetchOwnerStockReport(): Promise<StockReportData> {
  const { data, error } = await supabase.rpc('get_owner_stock_report');
  if (error) throw new Error(error.message);
  const payload = data as { products?: StockReportProduct[]; stock?: StockReportRow[] } | null;
  if (!payload || !Array.isArray(payload.products) || !Array.isArray(payload.stock)) {
    throw new Error('Respuesta inesperada del resumen de inventario');
  }
  return { products: payload.products, stockRows: payload.stock };
}

export interface StockReportFilters {
  departmentCodes: string[];
  categoryIds: string[];
  locationIds: string[];
  branchIds: string[];
}

export const EMPTY_STOCK_REPORT_FILTERS: StockReportFilters = {
  departmentCodes: [],
  categoryIds: [],
  locationIds: [],
  branchIds: [],
};

export interface StockSummary {
  productCount: number;
  costValue: number;
  potentialProfit: number;
  stockTotal: number;
}

export interface StockReportGroup {
  departmentName: string;
  categories: { categoryName: string; products: StockReportProduct[] }[];
}

function matchesCatalogFilters(product: StockReportProduct, filters: StockReportFilters): boolean {
  if (product.is_package) return false;
  if (filters.departmentCodes.length > 0 && !filters.departmentCodes.includes(product.department ?? '')) return false;
  if (filters.categoryIds.length > 0 && (!product.category_id || !filters.categoryIds.includes(product.category_id))) return false;
  return true;
}

export function computeStockSummary(products: StockReportProduct[], stockRows: StockReportRow[], filters: StockReportFilters): StockSummary {
  const scoped = new Map(products.filter((p) => matchesCatalogFilters(p, filters)).map((p) => [p.id, p]));
  const hasStockFilter = filters.branchIds.length > 0 || filters.locationIds.length > 0;
  const countedProductIds = new Set<string>();
  let costValue = 0;
  let potentialProfit = 0;
  let stockTotal = 0;

  for (const row of stockRows) {
    const product = scoped.get(row.product_id);
    if (!product) continue;
    if (filters.branchIds.length > 0 && !filters.branchIds.includes(row.branch_id)) continue;
    if (filters.locationIds.length > 0 && (!row.location_id || !filters.locationIds.includes(row.location_id))) continue;
    const quantity = Number(row.quantity);
    const cost = Number(product.cost_price);
    const sale = Number(product.sale_price);
    countedProductIds.add(product.id);
    costValue += quantity * cost;
    potentialProfit += quantity * (sale - cost);
    stockTotal += quantity * sale;
  }

  return {
    productCount: hasStockFilter ? countedProductIds.size : scoped.size,
    costValue,
    potentialProfit,
    stockTotal,
  };
}

export function groupProductsForReport(products: StockReportProduct[], departments: Department[], categories: Category[], filters: StockReportFilters): StockReportGroup[] {
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, Map<string, StockReportProduct[]>>();

  for (const product of products) {
    if (!matchesCatalogFilters(product, filters)) continue;
    const deptLabel = product.department ? departmentName.get(product.department) ?? product.department : 'Sin departamento';
    const catLabel = product.category_id ? categoryName.get(product.category_id) ?? 'Sin categoría' : 'Sin categoría';
    if (!groups.has(deptLabel)) groups.set(deptLabel, new Map());
    const cats = groups.get(deptLabel)!;
    if (!cats.has(catLabel)) cats.set(catLabel, []);
    cats.get(catLabel)!.push(product);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([deptName, cats]) => ({
      departmentName: deptName,
      categories: [...cats.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'es'))
        .map(([catName, items]) => ({
          categoryName: catName,
          products: items.sort((a, b) => a.name.localeCompare(b.name, 'es')),
        })),
    }));
}

export function locationOptionLabel(location: Location, branchName: string): string {
  return `${location.name} (${branchName.replace('BIENESTAR ', '')})`;
}
