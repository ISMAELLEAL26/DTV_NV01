/*
# Product photos storage bucket

1. New storage
- Public bucket `product-photos` for product images uploaded from the product form.
- Maximum file size 5 MB, image types only.

2. Security
- Public read (the bucket is public, so photos show in POS, inventory and catalog).
- Insert, update and delete limited to authenticated users with the products capability, matching the category logo bucket.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-photos', 'product-photos', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

DROP POLICY IF EXISTS catalog_insert_product_photos ON storage.objects;
CREATE POLICY catalog_insert_product_photos ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-photos' AND has_capability('products'));

DROP POLICY IF EXISTS catalog_update_product_photos ON storage.objects;
CREATE POLICY catalog_update_product_photos ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-photos' AND has_capability('products'))
  WITH CHECK (bucket_id = 'product-photos' AND has_capability('products'));

DROP POLICY IF EXISTS catalog_delete_product_photos ON storage.objects;
CREATE POLICY catalog_delete_product_photos ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-photos' AND has_capability('products'));
