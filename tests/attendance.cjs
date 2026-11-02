const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.TZ = 'Asia/Taipei';
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector, {
    value:'', textContent:'', innerHTML:'', hidden:false, open:false,
    classList:{toggle(){},add(){},remove(){}}, addEventListener(){},
    showModal(){this.open=true;}, close(){this.open=false;}, reset(){},
  });
  return nodes.get(selector);
}
let saved='',alerts=[],failSave=false;
class TestDate extends Date {
  constructor(...args){super(...(args.length?args:['2026-10-19T10:00:00+08:00']));}
}
const ctx = vm.createContext({
  Date:TestDate,Intl,console,crypto:require('node:crypto').webcrypto,
  window:{addEventListener(){}},navigator:{},
  document:{querySelector:node,querySelectorAll:()=>[]},
  localStorage:{getItem:()=>null,setItem:(key,value)=>{if(failSave)throw Error('QuotaExceeded');saved=value;}},
  setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
  alert:message=>alerts.push(message)
});
const cut=source.lastIndexOf("  $('#todayLabel')");
assert.ok(cut>0);
vm.runInContext(source.slice(0,cut)+
  'globalThis.api={get state(){return state},set state(x){state=x},bind,checkIn,migrate,selectedLesson,recordTimeText,renderStudents,applyBulkExtension,cancelBulkExtension,syncAllExpiries,renewalProjection,renew,disableRendering:()=>{renderAll=()=>{}}};})();',ctx);
const api=ctx.api;
function fixture() {
  api.state={version:5,leavePolicyVersion:2,activeClassId:'fri',
    rooms:[{id:'room',name:'測試教室'}],
    classes:[{id:'fri',name:'週五早班',roomId:'room',weekday:5},{id:'mon',name:'週一班',roomId:'room',weekday:1}],
    students:[{id:'s',classId:'fri',name:'測試學生',remaining:6,enrolledAt:'2026-09-01',baseExpiresAt:'2026-10-18',expiresAt:'2026-10-18'}],
    records:[],sessions:[],closures:[],
    attendanceSelections:[{classId:'fri',date:'2026-10-16',time:'09:30'}]};
  alerts=[];
}
api.bind();
fixture();
api.checkIn('s');
assert.equal(api.state.records.length,0,'must not deduct before confirmation');
assert.equal(api.state.students[0].remaining,6);
assert.ok(node('#offDayCheckinDialog').open);
assert.match(node('#offDayCheckinText').textContent,/2026\/10\/16.*09:30/);
node('#offDayCheckinDialog').close();
assert.equal(api.state.records.length,0,'cancel leaves records unchanged');
api.checkIn('s');
node('#confirmOffDayCheckin').onclick();
assert.equal(api.state.students[0].remaining,5);
const record=api.state.records[0];
assert.equal(record.eventDate,'2026-10-16');
assert.equal(record.eventTime,'09:30');
assert.match(record.createdAt,/2026-10-19/);
assert.match(api.recordTimeText(record),/簽到課堂：2026\/10\/16（星期五） 09:30/);
assert.match(api.recordTimeText(record),/登錄：2026\/10\/19/);
node('#confirmOffDayCheckin').onclick();
api.checkIn('s');
assert.equal(api.state.records.length,1,'duplicate does not deduct again');
const restored=api.migrate(JSON.parse(saved));
assert.equal(restored.records[0].eventTime,'09:30');
assert.equal(restored.attendanceSelections[0].date,'2026-10-16');
assert.equal(restored.students[0].remaining,5);
api.state=restored;
api.state.activeClassId='mon';
assert.equal(api.selectedLesson().date,'2026-10-19');
api.state.activeClassId='fri';
assert.equal(api.selectedLesson().date,'2026-10-16');
assert.equal(api.selectedLesson().time,'09:30');
fixture();
api.state.records=[{...record,eventTime:''}];
api.checkIn('s');
assert.equal(api.state.students[0].remaining,6,'legacy untimed record prevents double charge');
fixture();
api.state.records=[{...record,type:'leave'}];
api.checkIn('s');
assert.equal(api.state.students[0].remaining,6,'leave date blocks checkin');
fixture();
api.state.attendanceSelections[0].date='2026-10-19';
api.state.students[0].expiresAt='2026-11-01';
api.checkIn('s');
assert.equal(api.state.records.length,1,'same-day attendance needs no off-day confirmation');
fixture();
api.state.attendanceSelections[0].time='';
api.checkIn('s');
assert.equal(api.state.records.length,0);
assert.equal(alerts.length,1,'missing time requires selection');
fixture();
api.state.attendanceSelections[0].date='2026-10-23';
api.checkIn('s');
assert.equal(api.state.records.length,0,'eligibility uses selected class date');
console.log('PASS: backdated confirmation/cancel, class date/time, actual timestamp, duplicate/leave guards, migration, class selection persistence, same-day and expiry checks.');
fixture();
api.state.students.push(
  {...api.state.students[0],id:'other',classId:'mon',name:'另一班',remaining:0},
  {...api.state.students[0],id:'unset',name:'無期限',baseExpiresAt:'',expiresAt:''}
);
api.state.records.push({id:'old',studentId:'s',classId:'fri',studentName:'測試學生',type:'checkin',delta:-1,eventDate:'2026-10-01',eventTime:'',createdAt:'2026-10-01T01:30:00.000Z',note:'保留紀錄'});
const oldRecord=JSON.stringify(api.state.records[0]);
assert.ok(api.applyBulkExtension('2026-10-16','颱風假').error,'class is mandatory');
let result=api.applyBulkExtension('2026-10-16','颱風假','fri');
assert.equal(result.count,1);
assert.equal(api.state.students[0].expiresAt,'2026-10-25');
assert.equal(api.state.students[1].expiresAt,'2026-10-18','other class unchanged');
assert.equal(api.state.students[2].expiresAt,'');
assert.equal(api.state.students[0].remaining,6);
assert.equal(JSON.stringify(api.state.records[0]),oldRecord);
const firstId=api.state.bulkExtensions[0].id;
assert.ok(api.applyBulkExtension('2026-10-16','事假','fri').error);
assert.equal(api.applyBulkExtension('2026-10-16','事假','mon').count,1,'another class same date allowed');
assert.equal(api.applyBulkExtension('2026-10-23','事假','fri').count,1);
api.state=api.migrate(JSON.parse(saved));api.syncAllExpiries();
assert.equal(api.state.students[0].expiresAt,'2026-11-01');
assert.equal(api.cancelBulkExtension(firstId).count,1);
assert.equal(api.state.students[0].expiresAt,'2026-10-25','only one batch reversed');
assert.equal(api.state.students[1].expiresAt,'2026-10-25','other class extension preserved');
assert.equal(JSON.stringify(api.state.records[0]),oldRecord);
assert.equal(api.state.students[0].remaining,6);
assert.equal(api.state.records.filter(r=>r.type==='extension_cancel').length,1);
assert.ok(api.cancelBulkExtension(firstId).error,'cannot cancel twice');
api.state=api.migrate(JSON.parse(saved));api.syncAllExpiries();
assert.equal(api.state.students[0].expiresAt,'2026-10-25');
assert.ok(api.state.bulkExtensions[0].cancelledAt);
assert.equal(api.applyBulkExtension('2026-10-16','改正後','fri').count,1,'can reapply cancelled date');
let snapshot=JSON.stringify(api.state);
failSave=true;
assert.ok(api.cancelBulkExtension(api.state.bulkExtensions.at(-1).id).error);
assert.equal(JSON.stringify(api.state),snapshot);
assert.ok(api.applyBulkExtension('2026-10-30','事假','fri').error);
assert.equal(JSON.stringify(api.state),snapshot);
failSave=false;

// Real v2.8 backup structure: old all-class batch has no target IDs or student ledger.
fixture();
api.state.students.push({...api.state.students[0],id:'other',classId:'mon'});
api.state.bulkExtensions=[{id:'legacy',date:'2026-10-16',reason:'颱風假',count:2,createdAt:'2026-10-19T02:00:00.000Z'}];
api.state.students.forEach(s=>{
  s.manualExtensionDays=7;s.expiresAt='2026-10-25';
  api.state.records.push({id:'legacy-'+s.id,studentId:s.id,classId:s.classId,studentName:s.name,type:'extension',delta:0,eventDate:'2026-10-16',eventTime:'',createdAt:'2026-10-19T02:00:00.000Z',note:'全體順延 7 天'});
});
api.state=api.migrate(JSON.parse(JSON.stringify(api.state)));api.syncAllExpiries();
assert.ok(api.applyBulkExtension('2026-10-16','事假','fri').error,'legacy all-class blocks duplicate');
api.state.students[0].classId='mon'; // Moving classes must not hide the old contribution.
assert.equal(api.cancelBulkExtension('legacy').count,2);
assert.equal(api.state.students[0].expiresAt,'2026-10-18');
assert.equal(api.state.students[1].expiresAt,'2026-10-18');
assert.equal(api.state.records.filter(r=>r.type==='extension').length,2,'original audits retained');
assert.equal(api.applyBulkExtension('2026-10-16','正確班級','mon').count,2);

// Active renewal retains the contribution; an expired new term must not lose seven days.
api.disableRendering();
fixture();api.applyBulkExtension('2026-10-16','事假','fri');
const activeBatch=api.state.bulkExtensions[0].id;
node('#renewDate').value='2026-10-20';api.renew('s',1);
const renewedExpiry=api.state.students[0].expiresAt;
assert.equal(api.state.students[0].extensionBatchIds.length,1);
assert.equal(api.cancelBulkExtension(activeBatch).count,1);
assert.equal(api.state.students[0].remaining,12,'renewed lessons retained');
assert.equal(api.state.students[0].expiresAt,'2026-12-18');
assert.notEqual(api.state.students[0].expiresAt,renewedExpiry);
fixture();api.applyBulkExtension('2026-10-16','事假','fri');
const expiredBatch=api.state.bulkExtensions[0].id;
node('#renewDate').value='2026-11-01';api.renew('s',1);
assert.equal(api.state.students[0].extensionBatchIds.length,0);
api.applyBulkExtension('2026-11-02','另一次','fri');
api.state=api.migrate(JSON.parse(saved));api.syncAllExpiries();
const newTermExpiry=api.state.students[0].expiresAt;
assert.equal(api.cancelBulkExtension(expiredBatch).count,0);
assert.equal(api.state.students[0].expiresAt,newTermExpiry,'must not subtract from new term');
assert.equal(api.state.students[0].manualExtensionDays,7);
console.log('PASS: class-only extension, class/date duplicate guards, precise cancellation, legacy global recovery, class moves, reload/backup, renewal safety and atomic save failures.');
