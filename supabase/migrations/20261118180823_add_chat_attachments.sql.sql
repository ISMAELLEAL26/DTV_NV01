/*
# Add file/image attachments to chat messages

1. Changes
- Add `attachment_url` (text, nullable) to chat_messages — public URL of uploaded file.
- Add `attachment_name` (text, nullable) to chat_messages — original filename.
- Add `attachment_type` (text, nullable) to chat_messages — MIME type (image/png, application/pdf, etc).

2. New storage
- Public bucket `chat-attachments` for images and files shared in chat.
- Max 10 MB, allows images and common document types.

3. Security
- Bucket is public-readable so recipients can view attachments inline.
- Any authenticated user can upload to chat-attachments (all staff can chat).
- Users can only delete their own uploads.
*/

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_type text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

DROP POLICY IF EXISTS chat_attachments_insert ON storage.objects;
CREATE POLICY chat_attachments_insert ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS chat_attachments_update ON storage.objects;
CREATE POLICY chat_attachments_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'chat-attachments' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'chat-attachments' AND owner = auth.uid());

DROP POLICY IF EXISTS chat_attachments_delete ON storage.objects;
CREATE POLICY chat_attachments_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'chat-attachments' AND owner = auth.uid());
