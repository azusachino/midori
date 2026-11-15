ALTER TABLE imports ADD COLUMN progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0);
ALTER TABLE imports ADD COLUMN new_usable_nights INTEGER;
ALTER TABLE imports ADD COLUMN new_epochs TEXT;
