import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { Profile } from './types';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
  otherUser?: Profile | null;
  lastMessage?: ChatMessage | null;
  unreadCount: number;
}

interface ChatContextValue {
  conversations: ChatConversation[];
  unreadCount: number;
  sendMessage: (
    recipientId: string,
    body: string,
    attachment?: { url: string; name: string; type: string } | null
  ) => Promise<{ error: string | null; conversationId?: string }>;
  markAsRead: (conversationId: string) => Promise<void>;
  getMessages: (conversationId: string) => Promise<ChatMessage[]>;
  openChat: boolean;
  setOpenChat: (open: boolean) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  users: Profile[];
  floatingNotification: { senderName: string; body: string } | null;
  clearFloatingNotification: () => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

let audioCtxSingleton: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioCtxSingleton) return audioCtxSingleton;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtxSingleton = new AudioCtx();
    return audioCtxSingleton;
  } catch {
    return null;
  }
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

function playNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => playTone(ctx)).catch(() => {});
  } else {
    playTone(ctx);
  }
}

function playTone(ctx: AudioContext) {
  try {
    const now = ctx.currentTime;

    // Three-tone ascending notification (like a gentle chime)
    const notes = [
      { freq: 659.25, start: 0, dur: 0.15 },     // E5
      { freq: 783.99, start: 0.12, dur: 0.15 },  // G5
      { freq: 1046.50, start: 0.24, dur: 0.25 },  // C6
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.4, now + note.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.dur);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur);
    }
  } catch {
    // ignore
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openChat, setOpenChat] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [floatingNotification, setFloatingNotification] = useState<{ senderName: string; body: string } | null>(null);
  const notificationTimerRef = useRef<number | null>(null);
  const usersRef = useRef<Profile[]>([]);
  const activeConvRef = useRef<string | null>(null);

  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { activeConvRef.current = activeConversationId; }, [activeConversationId]);

  // Unlock audio on first user interaction
  useEffect(() => {
    const unlock = () => { unlockAudio(); };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  const loadUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, active, position')
      .eq('active', true)
      .order('full_name');
    if (!error && data) {
      setUsers(data as Profile[]);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data: convs } = await supabase
      .from('chat_conversations')
      .select('*')
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (!convs || convs.length === 0) {
      setConversations([]);
      setUnreadCount(0);
      return;
    }

    const otherIds = new Set<string>();
    convs.forEach((c: { participant_a: string; participant_b: string }) => {
      if (c.participant_a !== user.id) otherIds.add(c.participant_a);
      if (c.participant_b !== user.id) otherIds.add(c.participant_b);
    });

    let userMap: Record<string, Profile> = {};
    if (otherIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, active, position')
        .in('id', [...otherIds]);
      if (profiles) {
        userMap = Object.fromEntries(profiles.map((p) => [p.id, p as Profile]));
      }
    }

    const convIds = convs.map((c: { id: string }) => c.id);

    // Batch fetch all last messages and unread counts in single queries
    const { data: allLastMsgs } = await supabase
      .from('chat_messages')
      .select('*')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    const lastMsgByConv: Record<string, ChatMessage> = {};
    if (allLastMsgs) {
      for (const m of allLastMsgs as ChatMessage[]) {
        if (!lastMsgByConv[m.conversation_id]) {
          lastMsgByConv[m.conversation_id] = m;
        }
      }
    }

    const { count: totalUnreadCount } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .in('conversation_id', convIds)
      .eq('recipient_id', user.id)
      .is('read_at', null);

    const unreadByConv: Record<string, number> = {};
    if (allLastMsgs) {
      for (const m of allLastMsgs as ChatMessage[]) {
        if (m.recipient_id === user.id && !m.read_at) {
          unreadByConv[m.conversation_id] = (unreadByConv[m.conversation_id] ?? 0) + 1;
        }
      }
    }

    const enriched: ChatConversation[] = convs.map((conv: { id: string; participant_a: string; participant_b: string; created_at: string }) => {
      const otherId = conv.participant_a === user.id ? conv.participant_b : conv.participant_a;
      return {
        id: conv.id,
        participant_a: conv.participant_a,
        participant_b: conv.participant_b,
        created_at: conv.created_at,
        otherUser: userMap[otherId] ?? null,
        lastMessage: lastMsgByConv[conv.id] ?? null,
        unreadCount: unreadByConv[conv.id] ?? 0,
      };
    });

    enriched.sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.created_at;
      const bTime = b.lastMessage?.created_at ?? b.created_at;
      return bTime.localeCompare(aTime);
    });

    setConversations(enriched);
    setUnreadCount(totalUnreadCount ?? 0);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadUsers();
    loadConversations();
  }, [user, loadUsers, loadConversations]);

  const loadConversationsRef = useRef(loadConversations);
  useEffect(() => { loadConversationsRef.current = loadConversations; }, [loadConversations]);

  // Realtime: single subscription for ALL message changes (insert + update)
  // No polling needed — this handles instant delivery and read receipts
  // Subscription is stable — never resubscribes on loadConversations identity change
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('chat-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new as ChatMessage;
          if (msg.recipient_id === user.id) {
            playNotificationSound();
            const sender = usersRef.current.find((u) => u.id === msg.sender_id);
            const senderName = sender?.full_name ?? 'Usuario';
            const displayBody = msg.attachment_url ? (msg.attachment_type?.startsWith('image/') ? 'Foto' : msg.attachment_name ?? 'Archivo') : msg.body;
            setFloatingNotification({ senderName, body: displayBody });
          }
          loadConversationsRef.current();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        () => {
          loadConversationsRef.current();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (notificationTimerRef.current) window.clearTimeout(notificationTimerRef.current);
    };
  }, [user]);

  const sendMessage = useCallback(
    async (
      recipientId: string,
      body: string,
      attachment?: { url: string; name: string; type: string } | null
    ): Promise<{ error: string | null; conversationId?: string }> => {
      if (!user) return { error: 'No hay sesión activa' };
      const trimmed = body.trim();
      if (!trimmed && !attachment) return { error: 'Mensaje vacío' };

      const { data: convId, error: convError } = await supabase.rpc('get_or_create_conversation', {
        p_user_a: user.id,
        p_user_b: recipientId,
      });
      if (convError || !convId) return { error: convError?.message ?? 'Error al crear conversación' };

      const insertData: Record<string, string> = {
        conversation_id: convId as string,
        sender_id: user.id,
        recipient_id: recipientId,
      };
      if (trimmed) insertData.body = trimmed;
      if (attachment) {
        insertData.attachment_url = attachment.url;
        insertData.attachment_name = attachment.name;
        insertData.attachment_type = attachment.type;
      }

      const { error: insertError } = await supabase.from('chat_messages').insert(insertData);
      if (insertError) return { error: insertError.message };

      loadConversations();
      return { error: null, conversationId: convId as string };
    },
    [user, loadConversations]
  );

  const markAsRead = useCallback(
    async (conversationId: string) => {
      if (!user) return;
      await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('recipient_id', user.id)
        .is('read_at', null);
      loadConversations();
    },
    [user, loadConversations]
  );

  const getMessages = useCallback(async (conversationId: string): Promise<ChatMessage[]> => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    return (data as ChatMessage[]) ?? [];
  }, []);

  const clearFloatingNotification = useCallback(() => {
    setFloatingNotification(null);
    if (notificationTimerRef.current) window.clearTimeout(notificationTimerRef.current);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        unreadCount,
        sendMessage,
        markAsRead,
        getMessages,
        openChat,
        setOpenChat,
        activeConversationId,
        setActiveConversationId,
        users,
        floatingNotification,
        clearFloatingNotification,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
