-- Supabase installe pgcrypto dans le schéma « extensions » (pas dans « public » comme la base de test).
-- app.prepare_evening appelle gen_random_bytes avec search_path = app, public : sans ce schéma,
-- la préparation des tables d'une soirée échouerait sur le vrai projet. Un schéma absent du
-- search_path est ignoré par PostgreSQL : sans effet sur la base de test.
alter function app.prepare_evening(uuid) set search_path = app, public, extensions;
