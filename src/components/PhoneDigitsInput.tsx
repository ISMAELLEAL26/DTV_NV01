import { useRef, useEffect } from 'react';

interface PhoneDigitsInputProps {
  value: string;
  onChange: (val: string) => void;
}

export default function PhoneDigitsInput({ value, onChange }: PhoneDigitsInputProps) {
  const digits = value.padEnd(10, ' ').slice(0, 10).split('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current = refs.current.slice(0, 10);
  }, []);

  const focusBox = (idx: number) => {
    const el = refs.current[idx];
    if (el) { el.focus(); el.select(); }
  };

  const handleChange = (idx: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      const next = value.split('');
      next[idx] = ' ';
      onChange(next.join('').trimEnd());
      return;
    }
    const arr = value.padEnd(10, ' ').split('');
    let cursor = idx;
    for (const ch of cleaned) {
      if (cursor >= 10) break;
      arr[cursor] = ch;
      cursor++;
    }
    onChange(arr.join('').trimEnd());
    focusBox(Math.min(cursor, 9));
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx].trim() && idx > 0) {
      focusBox(idx - 1);
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      focusBox(idx - 1);
    } else if (e.key === 'ArrowRight' && idx < 9) {
      focusBox(idx + 1);
    }
  };

  const handleFocus = (idx: number) => {
    const el = refs.current[idx];
    if (el) el.select();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 10);
    if (pasted) {
      onChange(pasted);
      focusBox(Math.min(pasted.length, 9));
    }
  };

  return (
    <div className="flex gap-1.5" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={() => handleFocus(i)}
          className="h-11 w-9 rounded-lg border border-slate-300 text-center text-lg font-bold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 sm:h-12 sm:w-10"
        />
      ))}
    </div>
  );
}
