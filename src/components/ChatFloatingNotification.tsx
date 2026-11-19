import { useChat } from '@/lib/chat';
import { MessageCircle, X } from 'lucide-react';

export default function ChatFloatingNotification() {
  const { floatingNotification, clearFloatingNotification, setOpenChat } = useChat();

  if (!floatingNotification) return null;

  const handleClick = () => {
    clearFloatingNotification();
    setOpenChat(true);
  };

  return (
    <div
      className="fixed right-4 top-20 z-[55] animate-slide-in-right"
      role="alert"
    >
      <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-300 bg-white p-3.5 shadow-2xl ring-4 ring-emerald-100 transition hover:shadow-xl">
        <button onClick={handleClick} className="flex items-start gap-3 text-left">
          <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500">
            <MessageCircle size={20} className="text-white" />
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="min-w-0 max-w-[220px]">
            <div className="text-xs font-bold text-emerald-600">Tienes un nuevo mensaje</div>
            <div className="truncate text-sm font-medium text-slate-800">{floatingNotification.senderName}</div>
            <div className="truncate text-xs text-slate-500">{floatingNotification.body}</div>
            <div className="mt-1 text-[10px] font-semibold text-emerald-600">Toca para abrir el chat</div>
          </div>
        </button>
        <button
          onClick={clearFloatingNotification}
          className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
