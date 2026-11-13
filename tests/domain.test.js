import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,applyScan,searchRecords,reportRows} from '../src/domain.js';
test('synthetic records can be searched',()=>{const state=seed();assert.equal(state.records.length,120);assert.equal(searchRecords(state.records,'IRM-BX-1002').length,1)});
test('scan is staged and duplicate is rejected',()=>{const s=seed();const first=applyScan(s,{barcode:'IRM-BX-1002',action:'Box Retrieval',mode:'outbound'});assert.equal(first.state.events.length,1);assert.equal(first.state.events[0].status,'pending');const second=applyScan(first.state,{barcode:'IRM-BX-1002',action:'Box Retrieval',mode:'outbound'});assert.match(second.message,/Duplicate/);assert.equal(second.state.events.length,1)});
test('mismatched item type is rejected',()=>{const result=applyScan(seed(),{barcode:'IRM-FL-1001',action:'Box Retrieval',mode:'outbound'});assert.match(result.message,/item type/);assert.equal(result.state.events.length,0)});
test('report aggregation reflects scan',()=>{const result=applyScan(seed(),{barcode:'IRM-BX-1002',action:'Box Retrieval',mode:'outbound'});assert.equal(reportRows(result.state)[0].pending,1)});
