-- Capture HealthKit device and record metadata, plus the source export date.
ALTER TABLE records ADD COLUMN device_hw TEXT;
ALTER TABLE records ADD COLUMN device_sw TEXT;
ALTER TABLE records ADD COLUMN meta_json TEXT;
ALTER TABLE imports ADD COLUMN export_date TEXT;
