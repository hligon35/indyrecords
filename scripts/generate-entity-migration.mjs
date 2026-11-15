// Reproducible relational read model. Aggregate workflows remain the command authority.
import {writeFile} from 'node:fs/promises';
const domains={commercial:{table:'commercial_workspaces',collections:['accounts','locations','contacts','activities','tasks','agreements','estimates','plans','jobs','invoices','payments','outbox']},warehouse:{table:'sandbox_workspaces',collections:['records','orders','custody']},field:{table:'field_workspaces',collections:['jobs','vehicles','routes','custody','certificates','delivery','batches','telemetry','exports']}};
let sql=`CREATE TABLE operational_entities (
 customer_id TEXT NOT NULL REFERENCES customers(id), domain TEXT NOT NULL, collection TEXT NOT NULL,
 entity_id TEXT NOT NULL, payload TEXT NOT NULL, source_version INTEGER NOT NULL,
 status TEXT, service_date TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(customer_id,domain,collection,entity_id)
);
CREATE INDEX entities_filter ON operational_entities(customer_id,domain,collection,status,service_date,entity_id);
`;
for(const [domain,{table,collections}] of Object.entries(domains)){
 const keys=collections.map(k=>`'${k}'`).join(','),id="COALESCE(json_extract(j.value,'$.id'),json_extract(j.value,'$.barcode'),json_extract(j.value,'$.vehicleId'),json_extract(j.value,'$.accountId'))";
 const select=ref=>`SELECT ${ref}.customer_id,'${domain}',c.key,${id},j.value,${ref}.version,COALESCE(json_extract(j.value,'$.status'),json_extract(j.value,'$.stage')),COALESCE(json_extract(j.value,'$.date'),json_extract(j.value,'$.due')) FROM json_each(${ref}.payload) c JOIN json_each(c.value) j WHERE c.key IN (${keys}) AND ${id} IS NOT NULL`;
 const insert=ref=>`INSERT INTO operational_entities(customer_id,domain,collection,entity_id,payload,source_version,status,service_date) ${select(ref)} ON CONFLICT(customer_id,domain,collection,entity_id) DO UPDATE SET payload=excluded.payload,source_version=excluded.source_version,status=excluded.status,service_date=excluded.service_date,updated_at=CURRENT_TIMESTAMP WHERE operational_entities.payload<>excluded.payload;`;
 sql+=`CREATE TRIGGER ${domain}_entities_insert AFTER INSERT ON ${table} BEGIN ${insert('NEW')} END;\n`;
 sql+=`CREATE TRIGGER ${domain}_entities_update AFTER UPDATE OF payload ON ${table} BEGIN
 DELETE FROM operational_entities WHERE customer_id=NEW.customer_id AND domain='${domain}' AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload)c JOIN json_each(c.value)j WHERE c.key=operational_entities.collection AND c.key IN (${keys}) AND ${id}=operational_entities.entity_id);
 ${insert('NEW')} END;\n`;
 sql+=`CREATE TRIGGER ${domain}_entities_delete AFTER DELETE ON ${table} BEGIN DELETE FROM operational_entities WHERE customer_id=OLD.customer_id AND domain='${domain}'; END;\n`;
 sql+=`INSERT INTO operational_entities(customer_id,domain,collection,entity_id,payload,source_version,status,service_date) SELECT w.customer_id,'${domain}',c.key,${id},j.value,w.version,COALESCE(json_extract(j.value,'$.status'),json_extract(j.value,'$.stage')),COALESCE(json_extract(j.value,'$.date'),json_extract(j.value,'$.due')) FROM ${table} w JOIN json_each(w.payload)c JOIN json_each(c.value)j WHERE c.key IN (${keys}) AND ${id} IS NOT NULL;\n`;
}
await writeFile(new URL('../migrations/0011_relational_entities.sql',import.meta.url),sql);
console.log('Generated migration 0011. Apply locally; this command does not access a database.');
