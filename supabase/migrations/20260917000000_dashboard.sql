-- =====================================================================
-- Configuración del Dashboard (v7)
--
-- Guarda qué indicadores y paneles quieres ver, el período y tu meta,
-- para que tu laptop y tu celular muestren el mismo panel.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

alter table public.profiles
  add column if not exists dashboard jsonb;

comment on column public.profiles.dashboard is
  'Panel del Dashboard: período, meta, indicadores y orden de los paneles.';
