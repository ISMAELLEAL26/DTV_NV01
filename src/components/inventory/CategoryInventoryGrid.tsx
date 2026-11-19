import { useMemo } from 'react';
import { ImageIcon, Layers, Package } from 'lucide-react';
import type { Category, Product } from '@/lib/types';
import { EmptyState } from '@/components/ui';

interface CategoryInventoryGridProps {
  categories: Category[];
  products: Product[];
  isCounted: (productId: string) => boolean;
  onSelect: (categoryId: string) => void;
}

export default function CategoryInventoryGrid({ categories, products, isCounted, onSelect }: CategoryInventoryGridProps) {
  const stats = useMemo(() => {
    const map = new Map<string, { total: number; counted: number }>();
    for (const product of products) {
      if (!product.category_id) continue;
      const entry = map.get(product.category_id) ?? { total: 0, counted: 0 };
      entry.total += 1;
      if (isCounted(product.id)) entry.counted += 1;
      map.set(product.category_id, entry);
    }
    return map;
  }, [products, isCounted]);

  if (categories.length === 0) {
    return <EmptyState title="Sin categorías" description="Agrega categorías en Productos para poder contar por categoría." icon={<Layers size={48} />} />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {categories.map((category) => {
        const stat = stats.get(category.id) ?? { total: 0, counted: 0 };
        const percent = stat.total > 0 ? Math.round((stat.counted / stat.total) * 100) : 0;
        const empty = stat.total === 0;
        return (
          <button
            key={category.id}
            type="button"
            disabled={empty}
            onClick={() => onSelect(category.id)}
            className={`group flex flex-col overflow-hidden rounded-2xl border-2 bg-white text-left transition ${empty ? 'cursor-not-allowed border-slate-100 opacity-60' : 'border-slate-200 hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-lg'}`}
          >
            <div className="flex aspect-[4/3] items-center justify-center bg-slate-50">
              {category.image_url ? (
                <img src={category.image_url} alt={category.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
              ) : (
                <ImageIcon size={40} className="text-slate-300" />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="truncate text-base font-bold text-slate-800">{category.name}</div>
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <Package size={14} /> {stat.total} artículo{stat.total === 1 ? '' : 's'}
              </div>
              {!empty && (
                <div className="mt-auto">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>{stat.counted} de {stat.total} contados</span>
                    <span className="font-semibold text-emerald-700">{percent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )}
              {empty && <span className="mt-auto text-xs font-medium text-slate-400">Sin artículos para contar</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
