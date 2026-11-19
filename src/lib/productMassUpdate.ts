import type { Branch, Category, Location, Product, ProductBranchPrice, ProductStock } from '@/lib/types';
import { BRANCH_PRICE_FIELDS, branchPriceHeaders, type BranchPriceInput } from '@/lib/branchPrices';

const BASE_HEADERS_BEFORE_LOCATIONS = [
  'Código de barras 1',
  'SKU',
  'Nombre',
  'Descripción',
  'Código de barras 2',
  'Departamento',
  'Código de categoría',
] as const;

const HEADERS_BEFORE_BRANCH_PRICES = [
  'Unidad',
  'Precios compartidos',
  'Precio de costo',
  'Precio de venta 1',
  'Precio de venta 2',
  'Precio de venta 3',
] as const;

const HEADERS_AFTER_BRANCH_PRICES = [
  'IVA %',
  'IEPS %',
  'Venta a granel',
  'Control de inventario',
  'Activo',
  'Favorito',
  'Acumula puntos',
  'URL de foto',
] as const;

const SHARED_PRICES_HEADER = 'Precios compartidos';

export function locationHeader(branch: Branch): string {
  return `Ubicación ${branch.name}`;
}

export function buildMassUpdateHeaders(branches: Branch[]): string[] {
  return [
    ...BASE_HEADERS_BEFORE_LOCATIONS,
    ...branches.map(locationHeader),
    ...HEADERS_BEFORE_BRANCH_PRICES,
    ...branches.flatMap(branchPriceHeaders),
    ...HEADERS_AFTER_BRANCH_PRICES,
  ];
}

export type MassUpdateRowStatus = 'update' | 'same' | 'error';

export interface MassUpdateRow {
  line: number;
  barcode: string;
  productId: string | null;
  productName: string;
  changes: Partial<ProductChanges>;
  locationChanges: Record<string, string | null>;
  branchPriceInputs: Record<string, BranchPriceInput>;
  changedLabels: string[];
  status: MassUpdateRowStatus;
  error: string | null;
}

export type ProductChanges = Pick<Product, 'sku' | 'name' | 'description' | 'barcode' | 'barcode_2' | 'department' | 'category_id' | 'unit' | 'cost_price' | 'sale_price' | 'price_2' | 'price_3' | 'tax_rate' | 'ieps_rate' | 'bulk' | 'track_inventory' | 'prices_shared' | 'active' | 'favorite' | 'acumula_puntos' | 'image_url'>;

export interface CatalogContext {
  products: Product[];
  categories: Category[];
  locations: Location[];
  branches: Branch[];
  stockRows: ProductStock[];
  branchPrices: ProductBranchPrice[];
}

const YES_VALUES = ['sí', 'si', 'yes', '1', 'true'];
const NO_VALUES = ['no', '0', 'false'];

export function buildMassUpdateTemplateRows(catalog: CatalogContext): (string | number)[][] {
  const { products, categories, locations, branches, stockRows, branchPrices } = catalog;
  const categoryCode = new Map(categories.map((c) => [c.id, c.code]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const stockByKey = new Map(stockRows.map((r) => [`${r.product_id}|${r.branch_id}`, r.location_id]));
  const branchPriceByKey = new Map(branchPrices.map((r) => [`${r.product_id}|${r.branch_id}`, r]));
  return products.map((p) => [
    p.barcode ?? '',
    p.sku ?? '',
    p.name,
    p.description ?? '',
    p.barcode_2 ?? '',
    p.department ?? '',
    p.category_id ? categoryCode.get(p.category_id) ?? '' : '',
    ...branches.map((b) => {
      const locationId = stockByKey.get(`${p.id}|${b.id}`);
      return locationId ? locationName.get(locationId) ?? '' : '';
    }),
    p.unit,
    p.prices_shared ? 'Sí' : 'No',
    Number(p.cost_price),
    Number(p.sale_price),
    Number(p.price_2),
    Number(p.price_3),
    ...branches.flatMap((b) => {
      const row = branchPriceByKey.get(`${p.id}|${b.id}`);
      return BRANCH_PRICE_FIELDS.map((f) => (!p.prices_shared && row ? Number(row[f.field]) : ''));
    }),
    Number(p.tax_rate),
    Number(p.ieps_rate ?? 0),
    p.bulk ? 'Sí' : 'No',
    p.track_inventory ? 'Sí' : 'No',
    p.active ? 'Sí' : 'No',
    p.favorite ? 'Sí' : 'No',
    p.acumula_puntos ? 'Sí' : 'No',
    p.image_url ?? '',
  ]);
}

function parseYesNo(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (YES_VALUES.includes(normalized)) return true;
  if (NO_VALUES.includes(normalized)) return false;
  return null;
}

function parseNonNegative(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function evaluateMassUpdate(table: string[][], catalog: CatalogContext): MassUpdateRow[] {
  const [headerRow, ...dataRows] = table;
  if (!headerRow) return [];
  const columnIndex = new Map(headerRow.map((header, index) => [header.trim(), index]));
  const cell = (row: string[], header: string) => {
    const index = columnIndex.get(header);
    return index === undefined ? '' : (row[index] ?? '').toString().trim();
  };

  const productByMainBarcode = new Map<string, Product>();
  catalog.products.forEach((p) => { if (p.barcode) productByMainBarcode.set(p.barcode.toLowerCase(), p); });
  const productBySku = new Map(catalog.products.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
  const productByBarcode = new Map<string, Product>();
  catalog.products.forEach((p) => {
    if (p.barcode) productByBarcode.set(p.barcode.toLowerCase(), p);
    if (p.barcode_2) productByBarcode.set(p.barcode_2.toLowerCase(), p);
  });
  const categoryByCode = new Map(catalog.categories.map((c) => [(c.code ?? '').toLowerCase(), c]));
  const locationByBranchAndName = new Map(catalog.locations.map((l) => [`${l.branch_id}|${l.name.toLowerCase()}`, l]));
  const stockLocationByKey = new Map(catalog.stockRows.map((r) => [`${r.product_id}|${r.branch_id}`, r.location_id]));
  const branchPriceByKey = new Map(catalog.branchPrices.map((r) => [`${r.product_id}|${r.branch_id}`, r]));
  const seenBarcodes = new Set<string>();

  const headers = buildMassUpdateHeaders(catalog.branches);
  const missingHeaders = headers.filter((header) => !columnIndex.has(header));
  if (missingHeaders.length > 0) {
    return [{ line: 1, barcode: '', productId: null, productName: '', changes: {}, locationChanges: {}, branchPriceInputs: {}, changedLabels: [], status: 'error', error: `Faltan columnas en la plantilla: ${missingHeaders.join(', ')}.` }];
  }

  return dataRows
    .filter((row) => row.some((value) => String(value ?? '').trim() !== ''))
    .map((row, index): MassUpdateRow => {
      const line = index + 2;
      const barcode = cell(row, 'Código de barras 1');
      const base = { line, barcode, productId: null as string | null, productName: '', changes: {} as Partial<ProductChanges>, locationChanges: {} as Record<string, string | null>, branchPriceInputs: {} as Record<string, BranchPriceInput>, changedLabels: [] as string[] };
      const fail = (error: string): MassUpdateRow => ({ ...base, status: 'error', error });

      if (!barcode) return fail('Falta el código de barras 1 del producto.');
      const product = productByMainBarcode.get(barcode.toLowerCase());
      if (!product) return fail('No existe un producto con ese código de barras 1.');
      if (seenBarcodes.has(barcode.toLowerCase())) return fail('El código de barras 1 está repetido en el archivo.');
      seenBarcodes.add(barcode.toLowerCase());

      const changes: Partial<ProductChanges> = {};
      const labels: string[] = [];
      const locationChanges: Record<string, string | null> = {};
      const branchPriceInputs: Record<string, BranchPriceInput> = {};

      const newSku = cell(row, 'SKU');
      if (newSku !== '' && newSku !== (product.sku ?? '')) {
        const skuOwner = productBySku.get(newSku.toLowerCase());
        if (skuOwner && skuOwner.id !== product.id) return fail('El SKU ya pertenece a otro producto.');
        changes.sku = newSku;
        labels.push('SKU');
      }
      const setText = (header: string, field: 'name' | 'description' | 'department' | 'unit' | 'image_url') => {
        const value = cell(row, header);
        if (value === '') return;
        const current = (product[field] ?? '') as string;
        if (value !== current) { changes[field] = value; labels.push(header); }
      };
      setText('Nombre', 'name');
      setText('Descripción', 'description');
      setText('Departamento', 'department');
      setText('Unidad', 'unit');
      setText('URL de foto', 'image_url');

      for (const [header, field] of [['Código de barras 2', 'barcode_2']] as const) {
        const value = cell(row, header);
        if (value === '') continue;
        const owner = productByBarcode.get(value.toLowerCase());
        if (owner && owner.id !== product.id) return fail(`El código de barras de "${header}" ya pertenece a otro producto.`);
        if (value !== (product[field] ?? '')) { changes[field] = value; labels.push(header); }
      }

      const categoryCode = cell(row, 'Código de categoría');
      if (categoryCode !== '') {
        const category = categoryByCode.get(categoryCode.toLowerCase());
        if (!category) return fail(`La categoría "${categoryCode}" no existe.`);
        if (category.id !== product.category_id) { changes.category_id = category.id; labels.push('Categoría'); }
      }

      for (const branch of catalog.branches) {
        const header = locationHeader(branch);
        const locationName = cell(row, header);
        if (locationName === '') continue;
        const location = locationByBranchAndName.get(`${branch.id}|${locationName.toLowerCase()}`);
        if (!location) return fail(`La ubicación "${locationName}" no existe en ${branch.name}.`);
        if (location.id !== stockLocationByKey.get(`${product.id}|${branch.id}`)) {
          locationChanges[branch.id] = location.id;
          labels.push(header);
        }
      }

      const sharedRaw = cell(row, SHARED_PRICES_HEADER);
      if (sharedRaw !== '') {
        const parsed = parseYesNo(sharedRaw);
        if (parsed === null) return fail(`"${SHARED_PRICES_HEADER}" debe ser Sí o No.`);
        if (parsed !== product.prices_shared) { changes.prices_shared = parsed; labels.push(SHARED_PRICES_HEADER); }
      }
      const resultingShared = changes.prices_shared ?? product.prices_shared;

      for (const branch of catalog.branches) {
        const existing = branchPriceByKey.get(`${product.id}|${branch.id}`);
        for (const f of BRANCH_PRICE_FIELDS) {
          const header = `${f.header} ${branch.name}`;
          const value = cell(row, header);
          if (value === '') continue;
          const parsed = parseNonNegative(value);
          if (parsed === null) return fail(`"${header}" debe ser un número mayor o igual a cero.`);
          if (resultingShared) return fail(`"${header}" solo aplica cuando "${SHARED_PRICES_HEADER}" es No.`);
          if (!existing || parsed !== Number(existing[f.field])) {
            branchPriceInputs[branch.id] = { ...branchPriceInputs[branch.id], [f.field]: parsed };
            labels.push(header);
          }
        }
      }

      const numericFields: [string, 'cost_price' | 'sale_price' | 'price_2' | 'price_3' | 'tax_rate' | 'ieps_rate'][] = [
        ['Precio de costo', 'cost_price'],
        ['Precio de venta 1', 'sale_price'],
        ['Precio de venta 2', 'price_2'],
        ['Precio de venta 3', 'price_3'],
        ['IVA %', 'tax_rate'],
        ['IEPS %', 'ieps_rate'],
      ];
      for (const [header, field] of numericFields) {
        const value = cell(row, header);
        if (value === '') continue;
        const parsed = parseNonNegative(value);
        if (parsed === null) return fail(`"${header}" debe ser un número mayor o igual a cero.`);
        if (parsed !== Number(product[field] ?? 0)) { changes[field] = parsed; labels.push(header); }
      }

      const booleanFields: [string, 'bulk' | 'track_inventory' | 'active' | 'favorite' | 'acumula_puntos'][] = [
        ['Venta a granel', 'bulk'],
        ['Control de inventario', 'track_inventory'],
        ['Activo', 'active'],
        ['Favorito', 'favorite'],
        ['Acumula puntos', 'acumula_puntos'],
      ];
      for (const [header, field] of booleanFields) {
        const value = cell(row, header);
        if (value === '') continue;
        const parsed = parseYesNo(value);
        if (parsed === null) return fail(`"${header}" debe ser Sí o No.`);
        if (parsed !== product[field]) { changes[field] = parsed; labels.push(header); }
      }

      const finalName = changes.name ?? product.name;
      if (!finalName.trim()) return fail('El nombre no puede quedar vacío.');

      return {
        ...base,
        productId: product.id,
        productName: product.name,
        changes,
        locationChanges,
        branchPriceInputs,
        changedLabels: labels,
        status: labels.length > 0 ? 'update' : 'same',
        error: null,
      };
    });
}
