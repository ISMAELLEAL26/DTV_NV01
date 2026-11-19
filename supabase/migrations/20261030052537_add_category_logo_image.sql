/*
# Add logo image to categories

1. Modified tables
- `categories`: new nullable column `image_url` (text) with the public address of the category logo.

2. New storage
- Public bucket `category-logos` that holds category logos. Anyone with the address can view an image, matching how product and presentation photos work.

3. Security
- Only staff with the products capability can upload, replace, or delete category logos.
- Uploads are limited to the `category-logos` bucket.
- Re-running is safe: the bucket insert uses ON CONFLICT and policies are dropped before creation.

4. Notes
- Existing categories keep working without a logo; the inventory category screen shows a placeholder icon when image_url is empty.
*/

ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('category-logos', 'category-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "catalog_insert_category_logos" ON storage.objects;
CREATE POLICY "catalog_insert_category_logos" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'category-logos' AND has_capability('products'));

DROP POLICY IF EXISTS "catalog_update_category_logos" ON storage.objects;
CREATE POLICY "catalog_update_category_logos" ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'category-logos' AND has_capability('products'))
WITH CHECK (bucket_id = 'category-logos' AND has_capability('products'));

DROP POLICY IF EXISTS "catalog_delete_category_logos" ON storage.objects;
CREATE POLICY "catalog_delete_category_logos" ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'category-logos' AND has_capability('products'));
