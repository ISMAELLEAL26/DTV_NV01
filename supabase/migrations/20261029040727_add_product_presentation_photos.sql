/*
# Add photos to product presentations

1. Modified tables
- `product_presentations`: new nullable column `image_url` (text) with the public address of the photo shown at the point of sale.

2. New storage
- Public bucket `presentation-photos` that holds presentation photos. Anyone with the address can view an image, which matches how product photos already work.

3. Security
- Only staff with the products capability can upload, replace, or delete presentation photos.
- Uploads are limited to the `presentation-photos` bucket.
- Re-running is safe: the bucket insert uses ON CONFLICT and policies are dropped before creation.

4. Notes
- Photos are not deleted from storage when a presentation is removed; the file simply stops being referenced.
*/

ALTER TABLE product_presentations ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('presentation-photos', 'presentation-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "catalog_insert_presentation_photos" ON storage.objects;
CREATE POLICY "catalog_insert_presentation_photos" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'presentation-photos' AND has_capability('products'));

DROP POLICY IF EXISTS "catalog_update_presentation_photos" ON storage.objects;
CREATE POLICY "catalog_update_presentation_photos" ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'presentation-photos' AND has_capability('products'))
WITH CHECK (bucket_id = 'presentation-photos' AND has_capability('products'));

DROP POLICY IF EXISTS "catalog_delete_presentation_photos" ON storage.objects;
CREATE POLICY "catalog_delete_presentation_photos" ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'presentation-photos' AND has_capability('products'));
