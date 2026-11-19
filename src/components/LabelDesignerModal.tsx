import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import QRCode from 'qrcode';
import { Check, ImagePlus, Move, RotateCcw, Save, ScanLine, Settings2, Type, Upload } from 'lucide-react';
import type { Product } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { code128Svg, createDefaultLabelLayout, getProductCode, type LabelAlign, type LabelData, type LabelElement, type LabelLayout } from '@/lib/labelPrint';
import { LABEL_LOGO_STORAGE_KEY, type LabelTemplate } from '@/lib/labelTemplates';

interface LabelDesignerModalProps {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
  template: LabelTemplate;
  onSaveTemplate: (name: string, layout: LabelLayout) => void;
  departmentNames?: Record<string, string>;
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  element: LabelElement;
}

const fieldClass = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10';

function formatPrice(value: number): string {
  return `$${value.toLocaleString('es-MX', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function readStoredValue(key: string): string {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function PreviewElement({ element, data }: { element: LabelElement; data: LabelData }): ReactElement | null {
  if (!element.visible) return null;
  const style = {
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    fontSize: `${Math.max(7, element.fontSize * 0.72)}px`,
    fontWeight: element.bold ? 700 : 400,
    textAlign: element.align,
  } as const;
  const common = 'absolute overflow-hidden leading-tight text-black flex items-center px-0.5';
  const alignClass = element.align === 'center' ? 'justify-center' : element.align === 'right' ? 'justify-end' : 'justify-start';
  if (element.token === 'QR') return <div className={`${common} ${alignClass}`} style={style}><img src={data.qrDataUrl} alt="" className="h-full w-full object-contain" /></div>;
  if (element.token === 'LOGO') return <div className={`${common} ${alignClass}`} style={style}>{data.logoDataUrl && <img src={data.logoDataUrl} alt="" className="h-full w-full object-contain grayscale contrast-200" />}</div>;
  if (element.token === 'BARCODE') return <div className={`${common} ${alignClass}`} style={style} dangerouslySetInnerHTML={{ __html: code128Svg(data.code) }} />;
  const value = element.token === 'PRODUCTO' ? data.product.name.toUpperCase()
    : element.token === 'PRECIO' ? formatPrice(data.price)
      : element.token === 'CODIGO' ? data.code
        : element.token === 'DEPARTAMENTO' ? data.department.toUpperCase()
          : element.text;
  return <div className={`${common} ${alignClass}`} style={style}>{value}</div>;
}

export default function LabelDesignerModal({ open, onClose, product, template, onSaveTemplate, departmentNames = {} }: LabelDesignerModalProps) {
  const [layout, setLayout] = useState<LabelLayout>(() => template.layout);
  const [selectedElementId, setSelectedElementId] = useState('product');
  const [templateName, setTemplateName] = useState('');
  const [logoSource, setLogoSource] = useState('');
  const [previewQr, setPreviewQr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const selectedElement = layout.elements.find((element) => element.id === selectedElementId) ?? layout.elements[0];

  const buildData = (qrDataUrl = previewQr): LabelData | null => {
    if (!product) return null;
    return {
      product,
      price: Number(product.sale_price),
      code: getProductCode(product),
      department: departmentNames[product.department ?? ''] ?? product.department ?? product.category?.name ?? '',
      qrDataUrl,
      logoDataUrl: logoSource,
    };
  };

  const previewData = buildData();

  useEffect(() => {
    if (!open) return;
    setLayout(template.layout);
    setSelectedElementId('product');
    setLogoSource(readStoredValue(LABEL_LOGO_STORAGE_KEY));
    setError(null);
  }, [open, template]);

  useEffect(() => {
    let active = true;
    if (!product) { setPreviewQr(''); return () => { active = false; }; }
    QRCode.toDataURL(getProductCode(product), { margin: 0, width: 220, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (active) setPreviewQr(url); })
      .catch(() => { if (active) setPreviewQr(''); });
    return () => { active = false; };
  }, [product, open]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = ((event.clientX - drag.startX) / rect.width) * layout.width;
      const dy = ((event.clientY - drag.startY) / rect.height) * layout.height;
      setLayout((current) => ({
        ...current,
        elements: current.elements.map((element) => {
          if (element.id !== drag.id) return element;
          if (drag.mode === 'resize') {
            return { ...element, width: Math.max(2, Math.min(current.width - element.x, drag.element.width + dx)), height: Math.max(1, Math.min(current.height - element.y, drag.element.height + dy)) };
          }
          return { ...element, x: Math.max(0, Math.min(current.width - element.width, drag.element.x + dx)), y: Math.max(0, Math.min(current.height - element.height, drag.element.y + dy)) };
        }),
      }));
    };
    const stop = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  }, [layout.width, layout.height]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, element: LabelElement, mode: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedElementId(element.id);
    dragRef.current = { id: element.id, mode, startX: event.clientX, startY: event.clientY, element };
  };

  const updateElement = (patch: Partial<LabelElement>) => {
    setLayout((current) => ({ ...current, elements: current.elements.map((element) => element.id === selectedElementId ? { ...element, ...patch } : element) }));
  };

  const resetLayout = () => {
    setLayout(createDefaultLabelLayout());
    setSelectedElementId('product');
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      setLogoSource(value);
      try { window.localStorage.setItem(LABEL_LOGO_STORAGE_KEY, value); } catch { setError('El logo es demasiado grande para guardarlo localmente.'); }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleLogoUrl = (value: string) => {
    setLogoSource(value);
    try { window.localStorage.setItem(LABEL_LOGO_STORAGE_KEY, value); } catch { /* local storage can be unavailable in private windows */ }
  };

  const handleSaveTemplate = () => {
    const name = templateName.trim();
    if (!name) { setError('Escribe un nombre para la plantilla.'); return; }
    onSaveTemplate(name, layout);
    setTemplateName('');
    setError(null);
  };

  return (
    <Modal open={open} onClose={onClose} title="Diseñador de plantillas de etiquetas" size="2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><ScanLine size={18} className="text-emerald-600" /> Editando: {template.name}</div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">Arrastra los elementos dentro de la etiqueta. La impresión usa negro puro sobre blanco para impresoras térmicas de 203 dpi.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={resetLayout}><RotateCcw size={15} /> Restablecer plantilla</Button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(280px,1fr)_minmax(360px,1.35fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><Move size={16} className="text-emerald-600" /> Vista previa interactiva</div>
              <div ref={canvasRef} className={`relative mx-auto w-full max-w-[375px] overflow-hidden border-2 border-slate-700 bg-white shadow-lg ${layout.shape === 'rounded' ? 'rounded-[13%]' : 'rounded-none'}`} style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
                {previewData && layout.elements.map((element) => (
                  <div
                    key={element.id}
                    className={`absolute cursor-move ${selectedElementId === element.id ? 'z-10 ring-1 ring-emerald-500 ring-offset-1' : ''}`}
                    style={{ left: `${(element.x / layout.width) * 100}%`, top: `${(element.y / layout.height) * 100}%`, width: `${(element.width / layout.width) * 100}%`, height: `${(element.height / layout.height) * 100}%` }}
                    onPointerDown={(event) => startDrag(event, element, 'move')}
                  >
                    <PreviewElement element={element} data={previewData} />
                    {selectedElementId === element.id && <button type="button" aria-label="Cambiar tamaño" className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-emerald-600" onPointerDown={(event) => startDrag(event, element, 'resize')} />}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-slate-500"><Move size={13} /> Arrastra para mover · Esquina verde para redimensionar</div>
            </div>

            {!product && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Agrega productos a la cola para ver una vista previa con datos reales.</p>}

            <div className="rounded-xl border border-slate-200 p-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Guardar como plantilla nueva</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className={`${fieldClass} w-full min-w-0`} value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nombre de la plantilla" />
                <Button className="w-full sm:w-auto" onClick={handleSaveTemplate}><Save size={15} /> Guardar</Button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">Las plantillas guardadas quedan disponibles en el selector de la pantalla de Etiquetas.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><Settings2 size={16} className="text-emerald-600" /> Tamaño y márgenes</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="text-xs font-semibold text-slate-500">Ancho mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" min="10" value={layout.width} onChange={(event) => setLayout((current) => ({ ...current, width: Number(event.target.value) || 37.5 }))} /></label>
                <label className="text-xs font-semibold text-slate-500">Alto mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" min="10" value={layout.height} onChange={(event) => setLayout((current) => ({ ...current, height: Number(event.target.value) || 30 }))} /></label>
                <label className="text-xs font-semibold text-slate-500">Margen sup. mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" min="0" value={layout.marginTop} onChange={(event) => setLayout((current) => ({ ...current, marginTop: Number(event.target.value) || 0 }))} /></label>
                <label className="text-xs font-semibold text-slate-500">Margen izq. mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" min="0" value={layout.marginLeft} onChange={(event) => setLayout((current) => ({ ...current, marginLeft: Number(event.target.value) || 0 }))} /></label>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><Type size={16} className="text-emerald-600" /> Elementos dinámicos</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {layout.elements.map((element) => <button key={element.id} type="button" onClick={() => setSelectedElementId(element.id)} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${selectedElementId === element.id ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><span>{element.token === 'TEXTO' ? 'Texto libre' : `{{${element.token}}}`}</span><span className={element.visible ? 'text-emerald-600' : 'text-slate-300'}>{element.visible ? <Check size={15} /> : 'Oculto'}</span></button>)}
              </div>
              {selectedElement && <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
                <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-slate-600 sm:col-span-4"><input type="checkbox" checked={selectedElement.visible} onChange={(event) => updateElement({ visible: event.target.checked })} className="h-4 w-4 accent-emerald-600" /> Mostrar {selectedElement.token === 'TEXTO' ? 'texto libre' : `{{${selectedElement.token}}}`}</label>
                {selectedElement.token === 'TEXTO' && <label className="col-span-2 text-xs font-semibold text-slate-500 sm:col-span-4">Texto fijo<input className={`${fieldClass} mt-1 w-full`} value={selectedElement.text} onChange={(event) => updateElement({ text: event.target.value })} /></label>}
                <label className="text-xs font-semibold text-slate-500">X mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" value={selectedElement.x} onChange={(event) => updateElement({ x: Number(event.target.value) || 0 })} /></label>
                <label className="text-xs font-semibold text-slate-500">Y mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" value={selectedElement.y} onChange={(event) => updateElement({ y: Number(event.target.value) || 0 })} /></label>
                <label className="text-xs font-semibold text-slate-500">Ancho mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" min="1" value={selectedElement.width} onChange={(event) => updateElement({ width: Number(event.target.value) || 1 })} /></label>
                <label className="text-xs font-semibold text-slate-500">Alto mm<input className={`${fieldClass} mt-1 w-full`} type="number" step="0.1" min="1" value={selectedElement.height} onChange={(event) => updateElement({ height: Number(event.target.value) || 1 })} /></label>
                <label className="text-xs font-semibold text-slate-500">Fuente pt<input className={`${fieldClass} mt-1 w-full`} type="number" min="3" value={selectedElement.fontSize} onChange={(event) => updateElement({ fontSize: Number(event.target.value) || 3 })} /></label>
                <label className="text-xs font-semibold text-slate-500">Alineación<select className={`${fieldClass} mt-1 w-full`} value={selectedElement.align} onChange={(event) => updateElement({ align: event.target.value as LabelAlign })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>
                <label className="col-span-2 flex items-center gap-2 self-end text-xs font-semibold text-slate-600"><input type="checkbox" checked={selectedElement.bold} onChange={(event) => updateElement({ bold: event.target.checked })} className="h-4 w-4 accent-emerald-600" /> Negrita</label>
              </div>}
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><ImagePlus size={16} className="text-emerald-600" /> Logo en blanco y negro</div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Upload size={14} /> Subir logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} /></label>
                {logoSource && <button type="button" onClick={() => handleLogoUrl('')} className="text-xs font-semibold text-red-600 hover:underline">Quitar logo</button>}
              </div>
              <input className={`${fieldClass} mt-2 w-full`} value={logoSource.startsWith('data:') ? '' : logoSource} onChange={(event) => handleLogoUrl(event.target.value)} placeholder="O pega una URL de logo" />
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={onClose}>Listo</Button>
        </div>
      </div>
    </Modal>
  );
}
