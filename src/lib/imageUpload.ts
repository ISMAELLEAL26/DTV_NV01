import { supabase } from '@/lib/supabase';

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'El archivo debe ser una imagen.';
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) return 'La imagen no puede pesar más de 5 MB.';
  return null;
}

export async function uploadImage(bucket: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
