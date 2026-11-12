DO $$
BEGIN
    IF EXISTS (
        SELECT LOWER(BTRIM("Account"))
        FROM "User"
        GROUP BY LOWER(BTRIM("Account"))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot normalize User.Account: case-insensitive duplicates exist';
    END IF;
END $$;

UPDATE "User"
SET "Account" = LOWER(BTRIM("Account"));

ALTER TABLE "User"
ADD CONSTRAINT "User_Account_normalized_check"
CHECK ("Account" = LOWER(BTRIM("Account")) AND CHAR_LENGTH("Account") > 0);
