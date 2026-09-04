# Label fixtures

Real product photos plus the correct answer for each one. This is the ground
truth the date parser is tested against — without it there is nothing to assert,
and the parser is the hardest and highest-risk part of the backend.

## How to add photos

1. Photograph the label so the **date text is readable to you**. If you can't read
   it on your phone screen, the OCR has no chance either.
2. Save as JPG into this folder.
3. Name it `<category>-<short-name>.jpg`, lowercase, hyphens only:
   `medicine-panadol-extra.jpg`, `skincare-anessa-sunscreen.jpg`
4. Add one row to `manifest.csv`.

## Filling in manifest.csv

| column | what goes in it |
|---|---|
| `filename` | exact filename, e.g. `medicine-panadol-extra.jpg` |
| `date_text` | the date **exactly as printed**, verbatim: `EXP 03/25`, `TAMAT TEMPOH 25.03.2026` |
| `date_type` | `expiry` \| `best_before` \| `use_by` \| `manufacture` \| `pao` |
| `expected_date` | the correct answer in `YYYY-MM-DD` — what the parser must return |
| `language` | `en` \| `ms` \| `zh` \| `mixed` |
| `category` | one of the seeded ids: `medicine`, `supplement`, `skincare`, `cosmetic`, `food`, `aerosol`, `household` |
| `difficulty` | `easy` \| `medium` \| `hard` — your honest read |
| `notes` | anything odd: curved surface, embossed, faded, glare, two dates on the pack |

### Ambiguous or partial dates

Where only month and year are printed (`EXP 03/25`), the convention is **the last
day of that month** — `2025-03-31`. That is the safe reading for an expiry date.

For a `manufacture` date with a printed shelf life, put the *derived* expiry in
`expected_date` and explain the arithmetic in `notes`.

If a date is genuinely ambiguous (`03/04/25` with no way to tell day from month),
still add it — set `difficulty` to `hard` and say so in `notes`. Those cases are
what force the parser to ask the user instead of guessing, and having them in the
suite is how we prove it does.

## What makes a good set

Aim for 15–20, deliberately varied rather than 20 easy ones:

- at least 3 Malay labels (`TAMAT TEMPOH`, `BAIK SEBELUM`) and 2 Chinese
- at least 2 embossed or laser-etched dates (no ink contrast — these are brutal)
- at least 2 curved surfaces (bottles, tubes)
- a `best before` **and** a `use by`, so the distinction is covered
- one pack showing both a manufacture date and an expiry date
- one deliberately awful one: faded, glare, or scratched

The easy ones prove it works. The hard ones are what stop it embarrassing you
in front of a judge holding a real bottle.

## Privacy

These get committed to a **public** repository. Don't photograph anything showing
a pharmacy label with a patient name, prescription details, or an address.
