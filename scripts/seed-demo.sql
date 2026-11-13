-- FICTIONAL local test fixtures only. Never run against a company database.
INSERT OR IGNORE INTO customers(id,name) VALUES
('c1','Demo Medical'),('c2','Sample Legal'),('c3','Example Finance'),('c4','Test Archives');
INSERT OR IGNORE INTO locations(id,label) VALUES
('l1','A01-R01'),('l2','A01-R02'),('l3','A02-R01'),('l4','A02-R02');
INSERT OR IGNORE INTO records(id,barcode,customer_id,location_id,kind,status) VALUES
('r1','IRM-FL-1001','c1','l1','File','Stored'),
('r2','IRM-BX-1002','c2','l2','Box','Stored'),
('r3','IRM-BX-1003','c3','l3','Box','Stored'),
('r4','IRM-BX-1004','c4','l4','Box','Stored');
INSERT OR IGNORE INTO work_orders(id,customer_id,operation,status) VALUES
('wo1','c2','Box Retrieval','open');
INSERT OR IGNORE INTO work_order_items(work_order_id,record_id,status) VALUES
('wo1','r2','pending');
