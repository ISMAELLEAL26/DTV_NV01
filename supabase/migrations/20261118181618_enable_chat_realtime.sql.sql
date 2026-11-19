/*
# Enable realtime for chat tables

1. Changes
- Add `chat_messages` and `chat_conversations` to the `supabase_realtime` publication.
- Without this, Supabase Realtime subscriptions never fire for these tables,
  so messages only appear when the user manually refreshes.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
