begin;

-- Les soumissions publiques doivent pouvoir téléverser une photo avant modération.
-- Le bucket reste public en lecture, mais les fichiers sont limités aux images utiles.
update storage.buckets
set file_size_limit = 8000000,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'photos-articles';

drop policy if exists "Upload photos publics moderes" on storage.objects;
create policy "Upload photos publics moderes"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'photos-articles'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);

commit;
