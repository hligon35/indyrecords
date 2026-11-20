import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function timeClockDatabase(t) {
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 const migrations=new URL('../../apps/time-clock/migrations/',import.meta.url);
 for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort()){
  sqlite.exec(readFileSync(new URL(file,migrations),'utf8'));
 }
 const DB={
  prepare(sql){
   const bind=(...args)=>{
    const statement=sqlite.prepare(sql);
    return {
     first:()=>statement.get(...args),
     all:()=>({results:statement.all(...args)}),
     run:()=>statement.columns().length?{results:statement.all(...args)}:{meta:statement.run(...args)}
    };
   };
   return {bind,first:()=>bind().first(),all:()=>bind().all(),run:()=>bind().run()};
  },
  batch(statements){
   sqlite.exec('BEGIN');
   try{
    const results=statements.map(statement=>statement.run());
    sqlite.exec('COMMIT');
    return results;
   }catch(error){
    sqlite.exec('ROLLBACK');
    throw error;
   }
  }
 };
 return {DB,sqlite};
}
