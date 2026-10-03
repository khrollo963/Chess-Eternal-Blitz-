import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Pool} from 'pg';
import {migratePrivateSchema,verifyPrivateSchema} from '../src/storage/migrations.js';

const initialHash=createHash('sha256').update(readFileSync(new URL('../migrations/001-initial.sql',import.meta.url),'utf8')).digest('hex');
function database(history=[{version:1,sha256:initialHash}],failDdl=false){
  let rows=structuredClone(history),saved=structuredClone(history);
  const statements:string[]=[];
  const client={
    async query(sql:string,values:unknown[]=[]){
      statements.push(sql);
      if(failDdl && sql.includes('ALTER TABLE'))throw new Error('fixture ddl failure');
      if(sql==='BEGIN')saved=structuredClone(rows);
      if(sql==='ROLLBACK')rows=saved;
      if(sql.includes('FROM pg_namespace'))return{rowCount:1,rows:[{}]};
      if(sql.includes('SELECT version, sha256'))return{rowCount:rows.length,rows:structuredClone(rows)};
      if(sql.includes('INSERT INTO')&&sql.includes('schema_migrations'))rows.push({version:Number(values[0]),sha256:String(values[1])});
      return{rowCount:1,rows:[]};
    },release(){},
  };
  return{pool:{query:client.query,connect:async()=>client} as unknown as Pool,statements,history:()=>rows};
}

test('explicit migration upgrades the known v1 history once and startup remains read-only',async()=>{
  const db=database();
  await migratePrivateSchema(db.pool,{schema:'enochian_draw_test'});
  expect(db.history().map(row=>row.version)).toEqual([1,2]);
  expect(db.statements.some(sql=>sql.includes('ALTER TABLE')&&sql.includes("'draw'"))).toBe(true);
  db.statements.length=0;
  await migratePrivateSchema(db.pool,{schema:'enochian_draw_test'});
  expect(db.statements.some(sql=>/ALTER|INSERT/.test(sql))).toBe(false);
  db.statements.length=0;
  await verifyPrivateSchema(db.pool,'enochian_draw_test');
  expect(db.statements.every(sql=>sql.startsWith('SELECT'))).toBe(true);
});

test('startup rejects v1 without writes and migration rejects altered history without DDL',async()=>{
  const old=database();
  await expect(verifyPrivateSchema(old.pool,'enochian_draw_test')).rejects.toThrow();
  expect(old.statements.every(sql=>sql.startsWith('SELECT'))).toBe(true);
  const altered=database([{version:1,sha256:'wrong'}]);
  await expect(migratePrivateSchema(altered.pool,{schema:'enochian_draw_test'})).rejects.toThrow();
  expect(altered.statements.some(sql=>/ALTER|INSERT/.test(sql))).toBe(false);
  expect(altered.history()).toEqual([{version:1,sha256:'wrong'}]);
});

test('failed draw migration rolls back and never advances migration history',async()=>{
  const db=database(undefined,true);
  await expect(migratePrivateSchema(db.pool,{schema:'enochian_draw_test'})).rejects.toThrow();
  expect(db.history()).toEqual([{version:1,sha256:initialHash}]);
  expect(db.statements).toContain('ROLLBACK');
});
