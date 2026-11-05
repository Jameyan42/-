import test from 'node:test';import assert from 'node:assert/strict';import {companyToday} from './time';
test('北京时间凌晨不能被UTC前一天误判为未来付款日期',()=>assert.equal(companyToday(new Date('2026-11-04T16:05:00.000Z')),'2026-11-05'));
test('北京时间午夜前的记账日不提前切换',()=>assert.equal(companyToday(new Date('2026-11-05T15:59:59.000Z')),'2026-11-05'));
test('北京时间跨月和跨年按公司日历',()=>{assert.equal(companyToday(new Date('2026-10-31T16:00:00.000Z')),'2026-11-01');assert.equal(companyToday(new Date('2026-12-31T16:00:00.000Z')),'2027-01-01');});
