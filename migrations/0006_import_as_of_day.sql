-- Each import keeps the as-of day it produced; reads used to recompute today's value for every row.
ALTER TABLE imports ADD COLUMN as_of_day TEXT;
-- Backfill: the newest done import produced the current as-of day. Older rows cannot be
-- reconstructed exactly and stay NULL (unknown).
UPDATE imports
SET as_of_day = (SELECT MAX(unit_day) FROM metric_values WHERE metric = 'sleep_h' AND usable = 1)
WHERE id = (SELECT MAX(id) FROM imports WHERE status = 'done');
