import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import { Boxes, ArrowLeftRight } from 'lucide-react';
import InventoryAdjustmentPage from './InventoryAdjustmentPage';
import TransfersPage from './TransfersPage';

type Tab = 'inventory' | 'transfers';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'inventory', label: 'Inventario', icon: <Boxes size={16} /> },
  { key: 'transfers', label: 'Traspasos', icon: <ArrowLeftRight size={16} /> },
];

export default function InventoryTransfersPage() {
  const [tab, setTab] = useState<Tab>('inventory');

  return (
    <div className="device-page p-6">
      <PageHeader title="Inventario y Traspasos" subtitle="Ajustes de existencias y movimientos entre sucursales" />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inventory' && <InventoryAdjustmentPage />}
      {tab === 'transfers' && <TransfersPage />}
    </div>
  );
}
