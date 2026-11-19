/*
# App images storage bucket

1. New storage
- Public bucket `app-images` for images uploaded from the computer outside product photos: employee photos, branch photos/logos (also used on tickets), bank logos and advertisement images.
- Maximum file size 5 MB, image types only.

2. Security
- Public read so images render on tickets, POS and public pages.
- Insert, update and delete limited to administrators (is_admin()).
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('app-images', 'app-images', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

DROP POLICY IF EXISTS app_images_insert_admin ON storage.objects;
CREATE POLICY app_images_insert_admin ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'app-images' AND is_admin());

DROP POLICY IF EXISTS app_images_update_admin ON storage.objects;
CREATE POLICY app_images_update_admin ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'app-images' AND is_admin())
  WITH CHECK (bucket_id = 'app-images' AND is_admin());

DROP POLICY IF EXISTS app_images_delete_admin ON storage.objects;
CREATE POLICY app_images_delete_admin ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'app-images' AND is_admin());
