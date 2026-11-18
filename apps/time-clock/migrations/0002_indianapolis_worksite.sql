-- Approved worksite coordinates supplied for preview testing.
-- Confirm the actual facility entrance / authorized punch location with management.
-- Never auto-create employee identities or payroll mappings.
INSERT INTO worksites(id,name,latitude,longitude,radius_feet,geofence_enabled,enabled)
VALUES('irm-indianapolis-30th','IRM Indianapolis - 30th Street',39.80869,-86.05169,500,1,1)
ON CONFLICT(id) DO NOTHING;
