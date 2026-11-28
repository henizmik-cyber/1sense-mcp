-- Bodenrichtwerte beyond NRW: record which Land each zone belongs to, so the
-- tool can tell "this Land publishes no open BRW" apart from "no zone here".
ALTER TABLE bodenrichtwerte ADD COLUMN land TEXT;
UPDATE bodenrichtwerte SET land = '05' WHERE land IS NULL;
CREATE INDEX IF NOT EXISTS idx_brw_land ON bodenrichtwerte (land);
