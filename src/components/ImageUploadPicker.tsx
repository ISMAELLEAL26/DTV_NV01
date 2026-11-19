import { useEffect, useState } from 'react';
import { ImageIcon, Upload, X } from 'lucide-react';
import { validateImageFile } from '@/lib/imageUpload';

export interface ImageUploadValue {
  file: File | null;
  currentUrl: string | null;
  removed: boolean;
}

interface ImageUploadPickerProps {
  value: ImageUploadValue;
  onChange: (value: ImageUploadValue) => void;
  onError: (message: string) => void;
  alt: string;
  noun: string;
}

export default function ImageUploadPicker({ value, onChange, onError, alt, noun }: ImageUploadPickerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value.file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value.file]);

  const shownUrl = previewUrl ?? (value.removed ? null : value.currentUrl);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      onError(problem);
      return;
    }
    onChange({ file, currentUrl: value.currentUrl, removed: false });
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        {shownUrl ? <img src={shownUrl} alt={alt} className="h-full w-full object-cover" /> : <ImageIcon size={22} className="text-slate-300" />}
      </div>
      <div className="flex flex-col gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700">
          <Upload size={14} /> {shownUrl ? `Cambiar ${noun}` : `Subir ${noun}`}
          <input type="file" accept="image/*" onChange={onFileChange} className="sr-only" />
        </label>
        {shownUrl && (
          <button
            type="button"
            onClick={() => onChange({ file: null, currentUrl: value.currentUrl, removed: true })}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
          >
            <X size={12} /> Quitar {noun}
          </button>
        )}
      </div>
    </div>
  );
}
