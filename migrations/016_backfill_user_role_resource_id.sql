UPDATE user_roles AS ur
SET
  "resourceId" = u."branchId",
  "updatedAt" = now()
FROM "user" AS u
WHERE ur."userId" = u.id
  AND ur."deletedAt" IS NULL
  AND u."deletedAt" IS NULL
  AND (ur."resourceId" IS NULL OR btrim(ur."resourceId") = '')
  AND u."branchId" IS NOT NULL
  AND btrim(u."branchId") <> '';
