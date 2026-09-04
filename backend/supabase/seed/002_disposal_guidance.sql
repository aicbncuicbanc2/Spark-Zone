-- =============================================================================
-- Seed: disposal_guidance
--
-- Curated, deterministic advice. No LLM sits between a user and medical or
-- chemical disposal instructions.
--
-- !! BEFORE SUBMISSION: fill in source_url for every 'hazard' row with a real
-- !! published guideline. Unsourced disposal advice for medicine is the single
-- !! most challengeable thing in this project.
-- =============================================================================

insert into public.disposal_guidance
  (category_id, condition, locale, title, body, steps, severity, source_url)
values

-- --- medicine ----------------------------------------------------------------
('medicine', 'before_expiry', 'en',
 'Use or finish before the expiry date',
 'Medicines lose potency after their expiry date, and some degrade into compounds that are no longer safe. If this is a prescription you are still taking, check with your pharmacist before the date passes so a refill is ready.',
 array[
   'Check that the packaging is intact and the tablets or liquid look unchanged.',
   'Store away from heat, direct sunlight and bathroom humidity.',
   'If it is a course of antibiotics, finish the full course as prescribed.'
 ],
 'info', null),

('medicine', 'after_expiry', 'en',
 'Do not use - return to a pharmacy for safe disposal',
 'Expired medicine can be less effective or unsafe. Do not flush it down the toilet or pour it down the sink: the active compounds pass through water treatment and end up in waterways. Do not put loose tablets in household rubbish where children or animals can reach them.',
 array[
   'Keep the medicine in its original labelled packaging.',
   'Take it to a pharmacy that accepts unused medicines for disposal - many hospital and community pharmacies do.',
   'If no take-back point is reachable, ask a pharmacist how to dispose of it in your area.',
   'Never flush medicine or pour it down the drain.',
   'Scratch out personal details on the label before discarding the box.'
 ],
 'hazard', null),

-- --- medicine (Malay) --------------------------------------------------------
-- Demonstrates the locale mechanism end to end.
-- !! Have a native speaker review this string before demo day.
('medicine', 'after_expiry', 'ms',
 'Jangan guna - pulangkan ke farmasi untuk pelupusan selamat',
 'Ubat yang telah tamat tempoh mungkin kurang berkesan atau tidak selamat. Jangan buang ubat ke dalam tandas atau sinki, kerana bahan aktifnya boleh mencemari sumber air. Jangan biarkan ubat terdedah di dalam sampah rumah.',
 array[
   'Simpan ubat di dalam bungkusan asal yang berlabel.',
   'Bawa ke farmasi yang menerima ubat tidak terpakai untuk pelupusan.',
   'Jika tiada, tanya ahli farmasi cara pelupusan yang betul di kawasan anda.',
   'Jangan sekali-kali buang ubat ke dalam tandas atau sinki.'
 ],
 'hazard', null),

-- --- supplement --------------------------------------------------------------
('supplement', 'before_expiry', 'en',
 'Finish while still potent',
 'Vitamins and supplements lose potency well before they become unsafe. Fish oil and probiotics degrade fastest.',
 array[
   'Keep the bottle sealed and away from humidity.',
   'Move it to the front of the shelf so you actually see it.'
 ],
 'info', null),

('supplement', 'after_expiry', 'en',
 'Discard - reduced potency',
 'Expired supplements are usually not dangerous, just ineffective. Oils that smell rancid should be thrown out regardless of date.',
 array[
   'Empty the contents into household waste, sealed in a bag.',
   'Recycle the bottle separately if your area accepts it.'
 ],
 'caution', null),

-- --- skincare ----------------------------------------------------------------
('skincare', 'before_expiry', 'en',
 'Use it up - especially sunscreen',
 'Sunscreen that has passed its period-after-opening no longer gives the SPF printed on the bottle, which matters more than most people realise. Apply generously and daily rather than saving it.',
 array[
   'Use sunscreen daily rather than only at the beach.',
   'Apply body lotions and serums after showering while skin is damp.',
   'Check the open-jar symbol (for example 12M) for months-after-opening.'
 ],
 'info', null),

('skincare', 'after_expiry', 'en',
 'Stop using on skin',
 'Expired skincare can separate, grow bacteria, or irritate. Preservative systems break down over time, and eye-area products carry the highest infection risk.',
 array[
   'Stop applying to face and broken skin immediately.',
   'Discard if you see separation, colour change, or an off smell.',
   'Empty liquid contents into waste, then recycle clean containers.',
   'Do not pour large volumes of oily product down the sink.'
 ],
 'caution', null),

-- --- cosmetic ----------------------------------------------------------------
('cosmetic', 'before_expiry', 'en',
 'Use before it turns',
 'Cosmetics are dated from opening, not manufacture. Mascara and liquid eyeliner are the shortest-lived, typically around six months after first use.',
 array[
   'Note the date you opened it so the app can track it properly.',
   'Keep applicators clean and closed between uses.'
 ],
 'info', null),

('cosmetic', 'after_expiry', 'en',
 'Discard - infection risk',
 'Expired eye cosmetics are a genuine cause of eye infections. Once the preservative system fails, bacteria from the applicator multiply in the tube.',
 array[
   'Discard mascara and eyeliner without exception - do not top up with water.',
   'Wipe out and recycle rigid compacts where accepted.',
   'Clean brushes before using them with a replacement product.'
 ],
 'caution', null),

-- --- food --------------------------------------------------------------------
('food', 'before_expiry', 'en',
 'Plan a meal around it',
 'Use-by dates are a safety limit; best-before dates are a quality guideline. Food past its best-before date is often still perfectly good, but food past its use-by date is not.',
 array[
   'Cook the item that expires soonest first.',
   'Freeze what you cannot use in time - most items freeze well before the date, not after.',
   'Share unopened surplus rather than letting it lapse.'
 ],
 'info', null),

('food', 'after_expiry', 'en',
 'Check the date type before deciding',
 'A passed BEST BEFORE date usually means reduced quality, not danger. A passed USE BY date on chilled or high-risk food means discard it. When packaging is swollen, leaking, or smells wrong, discard regardless of date.',
 array[
   'Discard anything past its USE BY date without tasting it.',
   'Inspect best-before items for smell, colour and texture before deciding.',
   'Compost food waste where your area supports it.',
   'Never taste-test to check whether meat, dairy or seafood is still safe.'
 ],
 'caution', null),

-- --- aerosol -----------------------------------------------------------------
('aerosol', 'before_expiry', 'en',
 'Use up while the propellant works',
 'Aerosols lose pressure over time and the formulation can separate.',
 array[
   'Shake well and test-spray away from your face.',
   'Store below 50 C and away from direct sunlight.'
 ],
 'info', null),

('aerosol', 'after_expiry', 'en',
 'Pressurised - do not puncture, crush or burn',
 'An aerosol can is a pressure vessel even when it feels empty. Puncturing or incinerating it can cause it to burst.',
 array[
   'Do not pierce, crush, or throw the can into a fire.',
   'Release remaining pressure only by spraying as intended, outdoors.',
   'Take to a household hazardous waste collection point if one is available.',
   'If fully empty, recycle where your local scheme accepts aerosol cans.'
 ],
 'hazard', null),

-- --- household ---------------------------------------------------------------
('household', 'before_expiry', 'en',
 'Still effective - use it up',
 'Cleaning products lose effectiveness as active ingredients break down. Bleach in particular weakens noticeably within months.',
 array[
   'Use the oldest bottle first.',
   'Keep containers tightly closed and out of sunlight.'
 ],
 'info', null),

('household', 'after_expiry', 'en',
 'Dispose as chemical waste, never down the drain',
 'Expired cleaning chemicals can react unpredictably and should not be poured away in volume. Never mix leftover products together - bleach and ammonia produce toxic gas.',
 array[
   'Never mix leftover chemicals when disposing of them.',
   'Keep products in their original labelled containers.',
   'Take to a household hazardous waste collection point where available.',
   'Rinse and recycle empty containers separately.'
 ],
 'hazard', null)

on conflict (category_id, condition, locale) do update set
  title      = excluded.title,
  body       = excluded.body,
  steps      = excluded.steps,
  severity   = excluded.severity,
  source_url = excluded.source_url;
