# Independent catalog preview

Legacy snapshot: ../classic (v65), git branch archive/v65.
New source: this directory. Database: public.maps_next, not public.maps.

Before deploying, run schema.sql manually in Supabase SQL Editor.
It only creates the new owner-only table. No legacy data is migrated automatically.
The Copy legacy action reads one owner-selected source and inserts a deep snapshot.
Sharing is intentionally disabled in this preview until a separate access model is configured.
Never run the legacy destructive schema.sql to provision this version.

Deletion recovery stores a whole-map snapshot before deleting a card, column or note.
Restoring replaces the whole map (with confirmation); subsequent edits are not merged.
Last 20 deletion snapshots are stored in the new map JSON only.