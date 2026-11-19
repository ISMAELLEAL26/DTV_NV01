import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat, type ChatMessage } from '@/lib/chat';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { X, Send, Search, ArrowLeft, MessageCircle, Paperclip, ImageIcon, FileText, Download } from 'lucide-react';

export default function ChatModal() {
  const {
    openChat,
    setOpenChat,
    conversations,
    sendMessage,
    markAsRead,
    getMessages,
    activeConversationId,
    setActiveConversationId,
    users,
  } = useChat();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ url: string; name: string; type: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeConvRef = useRef<string | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  useEffect(() => { activeConvRef.current = activeConversationId; }, [activeConversationId]);

  const loadMessages = useCallback(async () => {
    if (!activeConversationId) return;
    setLoadingMessages(true);
    const msgs = await getMessages(activeConversationId);
    setMessages(msgs);
    setLoadingMessages(false);
    await markAsRead(activeConversationId);
  }, [activeConversationId, getMessages, markAsRead]);

  const loadMessagesRef = useRef(loadMessages);
  useEffect(() => { loadMessagesRef.current = loadMessages; }, [loadMessages]);

  useEffect(() => {
    if (openChat && activeConversationId) {
      loadMessages();
    } else {
      setMessages([]);
    }
  }, [openChat, activeConversationId, loadMessages]);

  // Realtime subscription for the active conversation — no polling
  useEffect(() => {
    if (!openChat || !activeConversationId) return;

    const channel = supabase
      .channel(`chat-conv-${activeConversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${activeConversationId}` },
        () => {
          loadMessagesRef.current();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${activeConversationId}` },
        () => {
          loadMessagesRef.current();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [openChat, activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() && !pendingAttachment) return;
    if (!activeConv) return;
    const recipientId = activeConv.participant_a === user?.id ? activeConv.participant_b : activeConv.participant_a;
    const body = input.trim();
    const attachment = pendingAttachment;
    setInput('');
    setPendingAttachment(null);
    const { error } = await sendMessage(recipientId, body, attachment);
    if (!error) {
      loadMessages();
    }
  };

  const handleStartConversation = async (recipientId: string) => {
    const { error, conversationId } = await sendMessage(recipientId, 'Hola!');
    if (!error && conversationId) {
      setShowNewChat(false);
      setActiveConversationId(conversationId);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = '';

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'bin';
      const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('chat-attachments')
        .upload(fileName, file, { contentType: file.type });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(fileName);

      setPendingAttachment({
        url: urlData.publicUrl,
        name: file.name,
        type: file.type || 'application/octet-stream',
      });
    } finally {
      setUploading(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.id !== user?.id &&
      u.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredConversations = conversations.filter((c) =>
    c.otherUser?.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  const getInitials = (name: string) => name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  const renderAvatar = (avatarUrl: string | null | undefined, name: string, size: string) => {
    if (avatarUrl) {
      return <img src={avatarUrl} alt={name} className={`${size} flex-shrink-0 rounded-full object-cover`} />;
    }
    return (
      <div className={`${size} flex-shrink-0 flex items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700`}>
        {getInitials(name) || '?'}
      </div>
    );
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
  };

  const renderAttachment = (msg: ChatMessage) => {
    if (!msg.attachment_url) return null;
    const isImage = msg.attachment_type?.startsWith('image/');
    if (isImage) {
      return (
        <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-1 block">
          <img src={msg.attachment_url} alt={msg.attachment_name ?? ''} className="max-w-full rounded-lg" style={{ maxHeight: 200 }} />
        </a>
      );
    }
    return (
      <a
        href={msg.attachment_url}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
          msg.sender_id === user?.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
        }`}
      >
        <FileText size={16} />
        <span className="flex-1 truncate">{msg.attachment_name ?? 'Archivo'}</span>
        <Download size={14} />
      </a>
    );
  };

  if (!openChat) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpenChat(false)} />
      <div className="relative flex w-full max-w-4xl h-[85vh] max-h-[85dvh] overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Left panel: conversation list or new chat */}
        <div className={`flex flex-col border-r border-slate-200 bg-slate-50 ${activeConversationId && !showNewChat ? 'hidden md:flex' : 'flex'} w-full md:w-80 ${activeConversationId && !showNewChat ? 'md:w-72' : ''}`}>
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
            {activeConversationId && !showNewChat ? (
              <button
                onClick={() => setActiveConversationId(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
              >
                <ArrowLeft size={20} />
              </button>
            ) : null}
            <h2 className="flex-1 text-base font-semibold text-slate-800">
              {showNewChat ? 'Nueva conversación' : 'Mensajes'}
            </h2>
            <button
              onClick={() => { setShowNewChat(!showNewChat); setSearch(''); }}
              className={`rounded-lg p-2 transition ${showNewChat ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}
              title="Nueva conversación"
            >
              <MessageCircle size={20} />
            </button>
            <button
              onClick={() => { setOpenChat(false); setActiveConversationId(null); setShowNewChat(false); }}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={20} />
            </button>
          </div>

          <div className="border-b border-slate-200 bg-white px-3 py-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {showNewChat ? (
              filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No hay usuarios disponibles</div>
              ) : (
                filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleStartConversation(u.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white"
                  >
                    {renderAvatar(u.avatar_url, u.full_name, 'h-10 w-10')}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{u.full_name}</div>
                      <div className="truncate text-xs text-slate-400">{u.position ?? u.username}</div>
                    </div>
                  </button>
                ))
              )
            ) : filteredConversations.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                No hay conversaciones aún.<br />Pulsa el icono de chat para iniciar una.
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => { setActiveConversationId(conv.id); setShowNewChat(false); }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white ${
                    activeConversationId === conv.id ? 'bg-blue-50' : ''
                  }`}
                >
                  {renderAvatar(conv.otherUser?.avatar_url, conv.otherUser?.full_name ?? 'Usuario', 'h-10 w-10')}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{conv.otherUser?.full_name ?? 'Usuario'}</span>
                      {conv.lastMessage && (
                        <span className="flex-shrink-0 text-[10px] text-slate-400">{formatTime(conv.lastMessage.created_at)}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {conv.lastMessage?.attachment_url && !conv.lastMessage.body
                          ? conv.lastMessage.attachment_type?.startsWith('image/') ? 'Foto' : conv.lastMessage.attachment_name ?? 'Archivo'
                          : conv.lastMessage?.body ?? 'Sin mensajes'}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel: message thread */}
        {activeConversationId && !showNewChat ? (
          <div className="flex flex-1 flex-col bg-white">
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <button
                onClick={() => setActiveConversationId(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
              >
                <ArrowLeft size={20} />
              </button>
              {renderAvatar(activeConv?.otherUser?.avatar_url, activeConv?.otherUser?.full_name ?? 'Usuario', 'h-10 w-10')}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{activeConv?.otherUser?.full_name ?? 'Usuario'}</div>
                <div className="truncate text-xs text-slate-400">{activeConv?.otherUser?.position ?? ''}</div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 px-4 py-4">
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">Cargando mensajes...</div>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">No hay mensajes aún. Envía el primero.</div>
              ) : (
                <div className="space-y-2">
                  {messages.map((msg) => {
                    const isMine = msg.sender_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                            isMine
                              ? 'rounded-br-sm bg-emerald-500 text-white'
                              : 'rounded-bl-sm bg-white text-slate-800'
                          }`}
                        >
                          {msg.attachment_url && renderAttachment(msg)}
                          {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
                          <div className={`mt-0.5 text-right text-[10px] ${isMine ? 'text-emerald-100' : 'text-slate-400'}`}>
                            {formatTime(msg.created_at)}
                            {isMine && msg.read_at && ' ✓✓'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Pending attachment preview */}
            {pendingAttachment && (
              <div className="flex items-center gap-2 border-t border-slate-200 bg-emerald-50 px-3 py-2">
                {pendingAttachment.type.startsWith('image/') ? (
                  <img src={pendingAttachment.url} alt="" className="h-12 w-12 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-200">
                    <FileText size={20} className="text-slate-500" />
                  </div>
                )}
                <span className="flex-1 truncate text-xs text-slate-600">{pendingAttachment.name}</span>
                <button
                  onClick={() => setPendingAttachment(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-3">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.xlsx,.docx"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Adjuntar archivo o foto"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {uploading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                ) : (
                  <Paperclip size={20} />
                )}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Escribe un mensaje..."
                className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-300 focus:bg-white"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() && !pendingAttachment}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center bg-slate-50 md:flex">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-400">Selecciona una conversación o inicia una nueva</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
