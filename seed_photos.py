"""
seed_photos.py — fetch iNaturalist default photos for entries in isr_species.json
that have an empty photos array, then merge the whole file into species.json.

Usage:
    python seed_photos.py

Reads:  data/isr_species.json, data/species.json
Writes: data/isr_species.json (photos filled in), data/species.json (merged)
"""

import json
import time
import urllib.request
import urllib.parse
import sys

ACCEPTED_LICENSES = {
    'cc-by', 'cc-by-sa', 'cc-by-nd',
    'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd',
    'cc0',
}

LICENSE_LABELS = {
    'cc-by':       'CC BY',
    'cc-by-sa':    'CC BY-SA',
    'cc-by-nd':    'CC BY-ND',
    'cc-by-nc':    'CC BY-NC',
    'cc-by-nc-sa': 'CC BY-NC-SA',
    'cc-by-nc-nd': 'CC BY-NC-ND',
    'cc0':         'CC0',
}

INAT_TAXA_URL = 'https://api.inaturalist.org/v1/taxa'
INAT_OBS_URL  = 'https://api.inaturalist.org/v1/observations'
HEADERS = {'User-Agent': 'Nautchiat/1.0 (personal ISR flora SRS; contact via GitHub)'}


def fetch_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def taxa_photo(scientific_name):
    """Try the taxa endpoint first — it always returns a curated default photo."""
    params = urllib.parse.urlencode({
        'q': scientific_name,
        'rank': 'species',
        'per_page': 5,
    })
    data = fetch_json(f'{INAT_TAXA_URL}?{params}')
    results = data.get('results', [])
    # Find exact name match first, then fall back to first result
    taxon = next(
        (t for t in results if t.get('name', '').lower() == scientific_name.lower()),
        results[0] if results else None,
    )
    if not taxon:
        return None
    photo = taxon.get('default_photo')
    if not photo:
        return None
    license_code = photo.get('license_code') or ''
    if license_code not in ACCEPTED_LICENSES:
        return None
    url = photo.get('medium_url') or (photo.get('url') or '').replace('/square.', '/medium.')
    if not url:
        return None
    return {
        'url': url,
        'license': LICENSE_LABELS.get(license_code, license_code.upper()),
        'attribution': photo.get('attribution', ''),
        'source': 'iNaturalist',
        'photo_id': str(photo.get('id', '')),
    }


def obs_photo(scientific_name):
    """Fall back to observations endpoint if taxa has no CC photo."""
    for page in (1, 2, 3):
        params = urllib.parse.urlencode({
            'taxon_name': scientific_name,
            'quality_grade': 'research',
            'per_page': 20,
            'page': page,
            'order_by': 'votes',
            'order': 'desc',
        })
        data = fetch_json(f'{INAT_OBS_URL}?{params}')
        results = data.get('results', [])
        if not results:
            break
        for obs in results:
            photos = obs.get('photos', [])
            if not photos:
                continue
            photo = photos[0]
            lc = photo.get('license_code') or ''
            if lc not in ACCEPTED_LICENSES:
                continue
            url = (photo.get('url') or '').replace('/square.', '/medium.')
            if not url:
                continue
            return {
                'url': url,
                'license': LICENSE_LABELS.get(lc, lc.upper()),
                'attribution': photo.get('attribution', ''),
                'source': 'iNaturalist',
                'photo_id': str(photo.get('id', '')),
            }
    return None


def seed_photos(species_list):
    seeded = 0
    skipped = 0
    failed = []
    for i, sp in enumerate(species_list):
        if sp.get('photos'):
            skipped += 1
            continue
        name = sp['scientific_name']
        print(f'  [{i+1}/{len(species_list)}] {name} ...', end=' ', flush=True)
        try:
            photo = taxa_photo(name) or obs_photo(name)
            if photo:
                sp['photos'] = [photo]
                print(f'OK ({photo["license"]})')
                seeded += 1
            else:
                print('no CC photo found')
                failed.append(name)
        except Exception as e:
            print(f'ERROR: {e}')
            failed.append(name)
        time.sleep(0.6)   # be polite to iNat API
    return seeded, skipped, failed


def merge_into_species(isr_list, existing_list):
    existing_ids = {s['id'] for s in existing_list}
    added = []
    for sp in isr_list:
        if sp['id'] not in existing_ids:
            existing_list.append(sp)
            added.append(sp['id'])
    return added


def main():
    print('Loading data files…')
    with open('data/isr_species.json', encoding='utf-8') as f:
        isr_list = json.load(f)
    with open('data/species.json', encoding='utf-8') as f:
        existing_list = json.load(f)

    needs_photo = [s for s in isr_list if not s.get('photos')]
    print(f'{len(isr_list)} species in isr_species.json; {len(needs_photo)} need photos.\n')

    print('Seeding photos from iNaturalist…')
    seeded, skipped, failed = seed_photos(isr_list)
    print(f'\nSeeded: {seeded}  Already had photos: {skipped}  Failed: {len(failed)}')
    if failed:
        print('No CC photo found for:')
        for name in failed:
            print(f'  - {name}')

    print('\nWriting updated isr_species.json…')
    with open('data/isr_species.json', 'w', encoding='utf-8') as f:
        json.dump(isr_list, f, ensure_ascii=False, indent=2)

    print('Merging into species.json…')
    added = merge_into_species(isr_list, existing_list)
    with open('data/species.json', 'w', encoding='utf-8') as f:
        json.dump(existing_list, f, ensure_ascii=False, indent=2)

    print(f'Added {len(added)} new species to species.json.')
    print(f'Total in species.json: {len(existing_list)}')
    print('\nDone.')


if __name__ == '__main__':
    main()
