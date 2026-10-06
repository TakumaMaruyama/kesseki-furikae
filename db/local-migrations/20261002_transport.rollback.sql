-- Local synthetic database only. Deletes all transport notices and issued codes.
-- Existing attendance, booking, capacity, users and courses are preserved.
BEGIN;
DROP TABLE transport_notices;
DROP TABLE transport_profiles;
COMMIT;
