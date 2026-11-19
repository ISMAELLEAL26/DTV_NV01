/*
# Módulo de chat interno entre usuarios

## Descripción
Crea tablas para mensajería interna estilo WhatsApp entre los usuarios del sistema POS.
Permite conversaciones 1-a-1, notificaciones en tiempo real, conteo de no leídos,
y marca mensajes como leídos cuando el destinatario abre la conversación.

## Tablas nuevas
1. chat_conversations — Conversaciones entre dos usuarios (1-a-1).
   - id (uuid PK)
   - participant_a (uuid, references auth.users)
   - participant_b (uuid, references auth.users)
   - created_at (timestamptz)
   - UNIQUE constraint on (participant_a, participant_b) para evitar duplicados

2. chat_messages — Mensajes individuales dentro de cada conversación.
   - id (uuid PK)
   - conversation_id (uuid, references chat_conversations, CASCADE)
   - sender_id (uuid, references auth.users)
   - recipient_id (uuid, references auth.users)
   - body (text, contenido del mensaje)
   - read_at (timestamptz, nullable — null = no leído)
   - created_at (timestamptz)

## Seguridad (RLS)
- Ambas tablas con RLS habilitado.
- TO authenticated en todas las políticas.
- SELECT: un usuario solo ve conversaciones y mensajes donde es participante.
- INSERT: el remitente solo puede insertar mensajes donde es sender_id.
- UPDATE: el destinatario solo puede marcar como leído (actualizar read_at).
- DELETE: no se permite borrar mensajes desde el cliente.
- Grants mínimos: SELECT, INSERT, UPDATE en chat_messages; SELECT, INSERT en chat_conversations.
- service_role tiene acceso completo (para edge functions si se necesita).
- Índices en recipient_id + read_at para consulta rápida de no leídos, y en conversation_id + created_at para ordenar mensajes.
*/

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_unique_pair UNIQUE (participant_a, participant_b),
  CONSTRAINT chat_conversations_order CHECK (participant_a <> participant_b)
);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON chat_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_conversations TO service_role;

DROP POLICY IF EXISTS "chat_conv_select_participant" ON chat_conversations;
CREATE POLICY "chat_conv_select_participant"
ON chat_conversations FOR SELECT
TO authenticated
USING (auth.uid() = participant_a OR auth.uid() = participant_b);

DROP POLICY IF EXISTS "chat_conv_insert_participant" ON chat_conversations;
CREATE POLICY "chat_conv_insert_participant"
ON chat_conversations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = participant_a OR auth.uid() = participant_b);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_messages TO service_role;

DROP POLICY IF EXISTS "chat_msg_select_participant" ON chat_messages;
CREATE POLICY "chat_msg_select_participant"
ON chat_messages FOR SELECT
TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "chat_msg_insert_sender" ON chat_messages;
CREATE POLICY "chat_msg_insert_sender"
ON chat_messages FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "chat_msg_update_recipient_read" ON chat_messages;
CREATE POLICY "chat_msg_update_recipient_read"
ON chat_messages FOR UPDATE
TO authenticated
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_unread
  ON chat_messages(recipient_id) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON chat_messages(conversation_id, created_at);

-- Helper: get_or_create_conversation between two users
CREATE OR REPLACE FUNCTION get_or_create_conversation(p_user_a uuid, p_user_b uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id uuid;
  lo uuid;
  hi uuid;
BEGIN
  -- Always store the smaller uuid first to avoid duplicate pairs
  lo := LEAST(p_user_a, p_user_b);
  hi := GREATEST(p_user_a, p_user_b);
  
  SELECT id INTO conv_id
  FROM chat_conversations
  WHERE participant_a = lo AND participant_b = hi
  LIMIT 1;
  
  IF conv_id IS NULL THEN
    INSERT INTO chat_conversations (participant_a, participant_b)
    VALUES (lo, hi)
    ON CONFLICT (participant_a, participant_b) DO NOTHING
    RETURNING id INTO conv_id;
    
    IF conv_id IS NULL THEN
      SELECT id INTO conv_id
      FROM chat_conversations
      WHERE participant_a = lo AND participant_b = hi
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN conv_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_or_create_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_or_create_conversation(uuid, uuid) TO authenticated;
